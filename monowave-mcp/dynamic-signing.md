# Dynamic SDK — Sign In/Up + Sign Tx (for the external MCP server)

Context for implementing a wallet MCP tool that signs in, signs out, and signs/broadcasts
Ambient (Solana) transactions using the **same Dynamic project** as the dapp.

---

## 1. Environment variables

Same Dynamic project as the dapp (`dapp/src/providers/AmbientChainProvider.tsx:10`):

| Env var | Value / source | Used by |
| --- | --- | --- |
| `DYNAMIC_ENVIRONMENT_ID` | `a9e7161d-c693-44be-8183-2c104ec7264e` (dapp uses `NEXT_PUBLIC_DYNAMIC_ENV_ID` with this fallback) | dapp + external MCP server |
| `DYNAMIC_AUTH_TOKEN` | Dynamic console → Developer → API Tokens. **Server-level credential, environment-wide — never expose to clients.** | `client.authenticateApiToken()` |
| `SESSION_PRIVATE_KEY_JWK` | Generated via `generateSessionKeyPair()`. Vault only. | `authenticateJwt(jwt, { getSessionSignature })` |
| `DYNAMIC_JWT` | Returned by email sign-in (`/emailVerifications/signin`) — per-user session token, short-lived | the signed-in user session |
| `AMBIENT_RPC_URL` | `https://rpc.ambient.xyz` | broadcast / simulate |
| `WALLET_PASSWORD` | Only if the embedded wallet was created with `backUpToDynamic: true` | sign calls |

Dapp `.env.local` for reference (`dapp/.env.local`):

```
NEXT_PUBLIC_RPC_ENDPOINT=http://rpc.ambient.xyz
NEXT_PUBLIC_INDEXER_WS_URL=wss://ambient-dex-git-indexer-130077224278.europe-west1.run.app
```

> The Dynamic **environment id** is the "project id" — there is no separate project id.
> Both the dapp and the external MCP server must use the same one, otherwise wallets created
> in the dapp are invisible to the server.

---

## 2. What the dapp already does (reference implementation)

| Concern | File | Dynamic API |
| --- | --- | --- |
| Provider setup | `dapp/src/providers/AmbientChainProvider.tsx` | `DynamicContextProvider` with `environmentId`, `SolanaWalletConnectors`, `EthereumWalletConnectors` |
| Connect / sign in | `dapp/src/components/wallet/useMyWallet.tsx:11` | `setShowAuthFlow(true)` |
| Sign out | `dapp/src/components/wallet/useMyWallet.tsx:12` | `handleLogOut()` |
| Pick active Solana wallet | `dapp/src/components/wallet/useMyWallet.tsx:8` | `useUserWallets()` + `isSolanaWallet(w)` |
| Sign transaction | `dapp/src/providers/walletShim.tsx:52-84` | `wallet.getSigner()` → `signer.signTransaction(tx)` |
| Broadcast | `dapp/src/providers/walletShim.tsx:85` | `connection.sendRawTransaction(raw)` |
| Import private key | `dapp/src/components/wallet/ImportWalletModal.tsx:28` | `useDynamicWaas().importPrivateKey({ privateKey, chainName: 'SOL' })` |
| Export private key | `dapp/src/components/wallet/ExportPrivateKeyModal.tsx:69` | `primaryWallet.connector.exportPrivateKey({ accountAddress, displayContainer })` |
| EVM send (bridge) | `dapp/src/components/bridge/useBridgeTransfer.ts:45-52` | `wallet.getWalletClient(chainId)`, `switchNetwork(chainId)`, `getPublicClient()` |

Sign + broadcast order used by the dapp (`walletShim.tsx:28-87`):

1. resolve wallet → `isSolanaWallet(wallet)` check
2. set `tx.feePayer = publicKey` if missing
3. set `tx.recentBlockhash` from `connection.getLatestBlockhash()` if missing
4. `connection.simulateTransaction(tx)` — abort on error
5. estimate fee via `connection.getFeeForMessage(tx.compileMessage())`
6. user confirms
7. `signer.signTransaction(tx)` → `signed.serialize()`
8. `connection.sendRawTransaction(raw)`

---

## 3. Sign in / sign up

### 3a. Email + OTP (headless, no browser)

Two REST calls to `https://app.dynamicauth.com/api/v0/sdk/{environmentId}`:

**Step 1 — send the code**

```
POST /emailVerifications/create
{ "email": "user@example.com" }
→ { "verificationUUID": "..." }
```

**Step 2 — verify the code, get a JWT**

```
POST /emailVerifications/signin
{ "verificationUUID": "...", "verificationToken": "123456" }
→ { "jwt": "eyJ..." }
```

The JWT is the session token. Persist it (in the MCP server: on disk / keychain) and use it
for all subsequent calls. Rate limit: **3 attempts / 10 min / email**.

Equivalent SDK helpers (client-side, in the dapp build): `sendEmailOTP()` and `verifyOTP()`
from `@dynamic-labs-sdk/client`.

### 3b. Wallet connect (browser UI)

The dapp cannot do this headlessly — it opens Dynamic's modal:

```ts
const { setShowAuthFlow, handleLogOut } = useDynamicContext();
setShowAuthFlow(true);   // sign in / sign up (email, social, wallet)
handleLogOut();          // sign out
```

For an MCP server there is no modal, so the practical options are:

- **Email OTP** (above) → server-side wallet SDK.
- **Browser-based wallet** → the dapp UI does it; the MCP server reads the resulting session
  (JWT / wallet address) from the shared session store.

### 3c. Server-side wallet SDK (what the MCP server should use)

Use the **agent flow** — email OTP + session-key binding:

```ts
import { DynamicSvmWalletClient } from '@dynamic-labs-wallet/node-svm';
import { createAuthClient, generateSessionKeyPair, signSessionMessage } from '@dynamic-labs-wallet/node';

const environmentId = process.env.DYNAMIC_ENVIRONMENT_ID!;

// 1. Session key pair — the private half lives in the vault, never on disk in plaintext.
const { publicKeyHex, privateKeyJwk } = await generateSessionKeyPair();

// 2. Email sign-in, binding the session public key into the JWT.
const auth = createAuthClient({ environmentId });
const { verificationUUID } = await auth.email.sendOtp('user@example.com');
const { jwt } = await auth.email.verifyOtp({ verificationUUID, code, sessionPublicKey: publicKeyHex });

// 3. Authenticate the wallet client with the JWT + the session signer.
const client = new DynamicSvmWalletClient({ environmentId });
await client.authenticateJwt(jwt, {
  getSessionSignature: (message) => signSessionMessage(message, privateKeyJwk),
});
```

Why the session key matters: with it bound, **a leaked JWT alone cannot sign** — the
keyshares relay requires a signed-session proof, which requires the session private key.
Without it, the JWT is a full wallet-takeover credential.

The SDK is **stateless**: every call needs the `walletMetadata` for that user, so store it
per user alongside the JWT.

---

## 4. Sign tx + broadcast

### 4a. Server-side (Node SDK) — the path the MCP server needs

**Important:** `client.signTransaction()` returns a **base58 Ed25519 signature (88 chars)**, NOT
a serialized transaction. You must attach it to the tx before broadcasting.

```ts
import {
  DynamicSvmWalletClient,
  decodeBase58,
  addSignatureToTransaction,
} from '@dynamic-labs-wallet/node-svm';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';

const connection = new Connection(process.env.AMBIENT_RPC_URL ?? 'https://rpc.ambient.xyz', 'confirmed');

// 1. Build the tx (e.g. reuse the manifest-sdk output from the existing mcp-server)
//    tx.feePayer and tx.recentBlockhash must be set.

const signatureBase58 = await client.signTransaction({
  walletMetadata,          // required, per-user
  transaction: tx,
  password: process.env.WALLET_PASSWORD,   // only if backUpToDynamic: true
  // externalServerKeyShares, // only in the caller-supplied-shares path
  // sponsor: true,        // only if SVM gas sponsorship is enabled in the console
});

// 2. Attach the signature
const signedTx = addSignatureToTransaction({
  transaction: tx,
  signature: decodeBase58(signatureBase58),
  signerPublicKey: new PublicKey(walletMetadata.accountAddress),
});

// 3. Broadcast
const txid = await connection.sendRawTransaction(signedTx.serialize());
await connection.confirmTransaction(txid, 'confirmed');
```

Gotchas:
- `decodeBase58` is required — `Buffer.from(base58String)` treats it as UTF-8 and produces garbage.
- For a `VersionedTransaction` (e.g. the base64 payload from the Checkout API) use
  `VersionedTransaction.deserialize(...)` and `sendRawTransaction(raw, { skipPreflight: true })`.
- `signTransaction` throws `WalletAccountNotSelectedError` when the wallet is external and the
  expected account is not the active one in the wallet app.
- `sponsor: true` requires SVM gas sponsorship enabled in the Dynamic console.

### 4b. Browser-side (React SDK) — how the dapp does it

```ts
import { isSolanaWallet } from '@dynamic-labs/solana';

const signer = await wallet.getSigner();          // wallet = primary/user wallet
const signed = await signer.signTransaction(tx);
const sig = await connection.sendRawTransaction(signed.serialize());
```

### 4c. Reusing the existing mcp-server tx builders

`mcp-server` already returns **unsigned base64 transactions** from tools like
`build_swap_tx`, `build_place_order_tx`, `build_batch_update_tx`. Those can be piped
straight into the sign step above — the external server only needs to:

1. call the builder tool → base64 unsigned tx
2. deserialize → `Transaction`
3. sign (4a) → attach signature
4. broadcast

Deserialization of the builder output:

```ts
const tx = Transaction.from(Buffer.from(base64Tx, 'base64'));
```

---

## 5. MCP tools to expose

| Tool | Args | Behaviour |
| --- | --- | --- |
| `wallet_sign_in_email` | `email` | Sends OTP, returns `verificationUUID` |
| `wallet_verify_email` | `verificationUUID`, `code` | Verifies OTP, stores JWT + wallet metadata, returns wallet address |
| `wallet_sign_out` | — | Clears the stored session (JWT + wallet metadata) |
| `wallet_status` | — | Returns `{ authenticated, address, chain, environmentId }` |
| `wallet_sign_tx` | `unsignedTxBase64` | Signs only, returns the base58 signature (no broadcast) |
| `wallet_send_tx` | `unsignedTxBase64` | Signs + broadcasts, returns `{ signature, txid }` |
| `wallet_import_private_key` | `privateKey` | Imports a SOL key (only if the project allows it) |

### Tool implementation sketch

```ts
// session store: JWT + walletMetadata + session key binding per user
const session = await loadSession(userId);

if (!session) return { content: [{ type: 'text', text: 'Not signed in. Call wallet_sign_in_email first.' }], isError: true };

const client = new DynamicSvmWalletClient({ environmentId: process.env.DYNAMIC_ENVIRONMENT_ID! });
// Session-key binding → a leaked JWT alone cannot sign.
await client.authenticateJwt(session.jwt, {
  getSessionSignature: (message) => signSessionMessage(message, session.privateKeyJwk),
});

const tx = Transaction.from(Buffer.from(unsignedTxBase64, 'base64'));
const signatureBase58 = await client.signTransaction({ walletMetadata: session.walletMetadata, transaction: tx });
const signedTx = addSignatureToTransaction({
  transaction: tx,
  signature: decodeBase58(signatureBase58),
  signerPublicKey: new PublicKey(session.walletMetadata.accountAddress),
});
const txid = await connection.sendRawTransaction(signedTx.serialize());
```

---

## 6. Threat model: what a leaked JWT gets you

There is no "cracking" involved. A JWT is a **replayable bearer credential** — an attacker
just uses it. Dynamic states this directly:

> "A leaked JWT could lead to access to user funds and wallet by an external party. **Anyone
> who obtains a valid JWT can perform any action the user can perform, including signing
> transactions, exporting keys, and draining wallets.**"
> — Dynamic, Backend JWT Security

Impact depends on **which wallet type** the server signs for:

| Wallet type | Leaked JWT alone → ? |
| --- | --- |
| Dapp embedded wallet (`useDynamicWaas`, `backUpToDynamic: true`) | **Full takeover.** Sign tx, and export the private key (needs the `wallet:export` elevated scope). This is the wallet type the dapp actually creates. |
| Server wallet (Node SDK `createWalletAccount`, caller-supplied shares) | **Not enough.** The keyshares relay requires a signed-session proof, which needs the **session private key** in your vault. A JWT alone cannot sign. |
| External wallet (Phantom, MetaMask) | No key material exposed, but **full impersonation** of the user against your backend for whatever the JWT authorizes. |

Dynamic also notes: *"Without Action-Based MFA, embedded wallet access is protected only by
the auth token and the user's login method — use short-lived tokens to limit risk."*

### The bigger risk is the API token, not the JWT

`DYNAMIC_AUTH_TOKEN` is **environment-wide**. `authenticateApiToken(token)` + a wallet's
`walletMetadata` lets you sign for **any** wallet in that Dynamic environment, not just one
user's. A leaked API token is strictly worse than a leaked JWT.

The current `getonyx-mcp` service also runs on Cloud Run with no authentication
(`mcp-server/README.md` → *Security note*: "the server itself sets no authentication"). If
signing tools are added to **that** deployment, anyone who can reach `/mcp` inherits its
signing power. The wallet MCP server must be a **separate deployment** behind auth (IAP /
bearer token), not bolted onto the public one.

### Storage classes (per Dynamic's guidance)

| Artifact | Where | Never |
| --- | --- | --- |
| Session private key (`privateKeyJwk`) | Secrets vault / KMS / HSM | Plain file or DB column |
| User JWT | Encrypted at rest, or memory only | Plaintext DB, disk, or logs |
| `walletMetadata` | Durable store (Redis/Postgres) — non-sensitive | — |
| `externalServerKeyShares` | Secrets vault / HSM | Plaintext |
| `WALLET_PASSWORD` | Secrets vault | Source code, logs |
| OTP codes, decrypted key shares | Memory only | Persist at all |

### Required mitigations

1. **Short JWT lifetime** — set it as low as tolerable in the Dynamic dashboard
   (Security Settings → JWT expiration; max is 30 days).
2. **Never log or return the JWT** — not in tool output, not in `console.error`, not in
   Cloud Run logs. `console.error` in the MCP server goes straight to Cloud Logging.
3. **Session-key binding** — use the agent pattern
   (`generateSessionKeyPair()` + `authenticateJwt(jwt, { getSessionSignature })`) so a leaked
   JWT alone cannot drive signing. The session private key stays in the vault.
4. **Narrow API token** — create one with only the wallet/sign permissions it needs, and
   rotate it.
5. **Auth on the MCP endpoint** — the wallet server must not be publicly reachable.
6. **Sign-out must delete** the stored JWT **and** the session key binding.
7. **Revoke on breach** — Dynamic dashboard → Security Settings → *Revoke Active Sessions*
   invalidates all sessions in the environment (cannot be undone).
8. **Gate `importPrivateKey` / `exportPrivateKey`** — these are high-risk; disable or
   restrict them in the tool surface.
