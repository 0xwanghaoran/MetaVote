# MetaVote

MetaVote is a Fully Homomorphic Encryption (FHE) powered polling system for confidential voting and publicly verifiable
results. Votes are encrypted end-to-end, tallies stay private during the voting window, and anyone can publish proven
results on-chain after the poll ends.

## Overview

MetaVote enables:
- Permissionless poll creation with 2 to 4 options, start time, and end time.
- Encrypted voting where no party can see individual choices.
- On-chain tallying on encrypted data during the poll.
- Public decryption only after finalization, with a cryptographic proof.
- On-chain publication of the final results for transparent verification.

The system is designed for situations where privacy and public verifiability are both required, such as community
governance, funding decisions, event planning, or any vote where early results could influence outcomes.

## Problems Solved

- Early leakage of results: Tallies stay encrypted until the poll is finalized.
- Trust in off-chain tallying: On-chain encrypted tallies and proof-based decryption remove the need for a trusted
  counter.
- Result integrity: Published results must pass Zama's decryption proof verification.
- Participation privacy: Individual votes are never stored in plaintext and cannot be derived from on-chain state.
- Permissioned control: Anyone can finalize or publish results once the poll ends, removing gatekeepers.

## Advantages

- Strong privacy: Fully homomorphic encryption keeps votes confidential throughout the poll.
- Public accountability: Final results are stored on-chain with verifiable proof.
- No secret custody: The contract never holds plaintext votes.
- Permissionless operations: Any address can finalize and publish results after the deadline.
- Clear lifecycle: Create, vote, finalize, decrypt, publish - each step is explicit and auditable.
- Minimal data exposure: Only poll metadata and final tallies are public.

## How the FHE Flow Works

1. Create poll
   - Creator defines a title, 2-4 options, and a voting window.
2. Encrypt vote
   - The frontend uses the Zama relayer SDK to encrypt the chosen option.
3. On-chain tally update
   - The contract compares the encrypted choice to each option index and increments encrypted tallies.
4. Finalize after deadline
   - Anyone can finalize once the poll ends.
   - Tallies are marked publicly decryptable (still not plaintext on-chain).
5. Public decrypt
   - Anyone can request decryption from the relayer and receive clear tallies plus a proof.
6. Publish results on-chain
   - The contract verifies the proof and stores the final results and proof for auditing.

## Architecture

### Smart Contract
- `contracts/MetaVote.sol`
- Core functions:
  - `createPoll` - creates a new poll with title, options, and time window.
  - `castVote` - submits an encrypted vote.
  - `finalizePoll` - marks tallies publicly decryptable after end time.
  - `publishResults` - verifies decryption proof and stores clear results.
  - `getPollSummary`, `getPollOptions`, `getEncryptedTallies`, `getPublishedResults`, `hasUserVoted`

### Frontend (app)
- Location: `app/`
- React + Vite UI for poll creation, encrypted voting, and result publishing.
- Reads contract data using viem, writes transactions with ethers.
- Uses Zama relayer SDK for encryption and public decryption.
- No local storage or environment variables are used in the frontend.
- The UI is Sepolia-only and does not connect to localhost networks.

### Hardhat Tasks
- Location: `tasks/metaVote.ts`
- Convenience tasks for creating polls, voting, finalizing, decrypting, and publishing.

## Tech Stack

- Solidity 0.8.27
- Hardhat + hardhat-deploy
- Zama FHEVM and relayer SDK
- Ethers v6 (writes), viem (reads)
- React 19 + Vite + TypeScript
- RainbowKit + wagmi for wallet connectivity
- Plain CSS (no Tailwind)

## Project Structure

```
contracts/                 MetaVote smart contract
deploy/                    Deployment scripts
tasks/                     Hardhat tasks
test/                      Contract tests
deployments/sepolia/       Contract deployment artifacts and ABI
app/                       React frontend (Vite)
```

## Setup and Usage

### Prerequisites

- Node.js >= 20
- npm >= 7
- A Sepolia wallet with test ETH
- Infura API key (for Sepolia RPC)
- WalletConnect project id (for the frontend)

### Install dependencies

```bash
npm install
cd app
npm install
```

### Environment configuration (contracts only)

Create a `.env` file in the repository root with:

```
INFURA_API_KEY=your_infura_key
PRIVATE_KEY=your_private_key
ETHERSCAN_API_KEY=optional_for_verification
```

Notes:
- Use `PRIVATE_KEY` only. Do not use MNEMONIC.
- `PRIVATE_KEY` can be with or without the `0x` prefix.

### Compile and test

```bash
npm run compile
npm run test
```

### Local deployment workflow (contracts only)

```bash
npm run chain
npm run deploy:localhost
```

### Sepolia deployment workflow

```bash
npm run deploy:sepolia
npm run verify:sepolia <DEPLOYED_CONTRACT_ADDRESS>
```

### Hardhat tasks (optional)

```bash
npx hardhat task:create-poll --title "Launch Theme" --options "Blue,Red,Gold" --start 1710000000 --end 1710100000
npx hardhat task:vote --poll 0 --choice 1
npx hardhat task:finalize --poll 0
npx hardhat task:decrypt-results --poll 0
npx hardhat task:publish-results --poll 0
```

### Frontend setup

1. Set the WalletConnect project id in `app/src/config/wagmi.ts`.
2. Copy the ABI from `deployments/sepolia/MetaVote.json` into `app/src/config/contracts.ts`.
3. Update `CONTRACT_ADDRESS` in `app/src/config/contracts.ts` with the Sepolia deployment address.

Run the frontend:

```bash
cd app
npm run dev
```

Open the app in your browser, connect your wallet, and paste the Sepolia contract address if needed.

## Poll Lifecycle in the UI

- Create poll: set title, options, start and end times.
- Vote: select an option and submit an encrypted vote.
- Finalize: after the end time, click "Finalize poll" to make tallies decryptable.
- Decrypt: use the relayer to decrypt publicly decryptable tallies.
- Publish: submit the decrypted tallies and proof on-chain.

## Privacy and Security Notes

- Votes are encrypted client-side before hitting the chain.
- The contract never receives plaintext votes.
- Tallies are encrypted on-chain and only become decryptable after finalization.
- Published results require a valid Zama decryption proof.
- The voting address is visible on-chain, but the choice is not.
- One vote per address per poll is enforced.

## Limitations

- Sepolia-only in the frontend configuration.
- Poll options are limited to 2-4.
- Decryption relies on the Zama public decryption relayer.
- On-chain privacy does not hide the fact that an address voted.

## Future Roadmap

- Multi-chain support for additional FHEVM networks.
- Better UX for schedule input, results charts, and accessibility.
- Gas and performance optimizations for large numbers of polls.
- Optional voter eligibility lists or signature-gated polls.
- Indexing service for faster poll discovery and analytics.
- Auditable exports for external reporting or governance tooling.
- Advanced voting modes (ranked choice, weighted votes).

## License

BSD-3-Clause-Clear. See `LICENSE`.
