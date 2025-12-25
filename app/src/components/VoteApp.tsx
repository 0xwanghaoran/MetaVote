import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useAccount, useChainId, usePublicClient } from 'wagmi';
import { Contract } from 'ethers';

import { Header } from './Header';
import { useEthersSigner } from '../hooks/useEthersSigner';
import { useZamaInstance } from '../hooks/useZamaInstance';
import { CONTRACT_ABI, CONTRACT_ADDRESS } from '../config/contracts';
import '../styles/VoteApp.css';

const SEPOLIA_CHAIN_ID = 11155111;

type PollRecord = {
  id: number;
  title: string;
  options: string[];
  startTime: bigint;
  endTime: bigint;
  optionCount: bigint;
  finalized: boolean;
  resultsPublished: boolean;
  creator: `0x${string}`;
  userVoted: boolean;
  publishedResults?: number[];
  publishedProof?: `0x${string}`;
};

type DecryptedResults = {
  tallies: number[];
  proof: `0x${string}`;
};

type Notice = {
  type: 'info' | 'error' | 'success';
  text: string;
};

type PollPhase = 'upcoming' | 'active' | 'ended' | 'finalized' | 'published';

const statusLabels: Record<PollPhase, string> = {
  upcoming: 'Opens soon',
  active: 'Voting live',
  ended: 'Voting ended',
  finalized: 'Decryptable',
  published: 'Published',
};

const statusDescriptions: Record<PollPhase, string> = {
  upcoming: 'Countdown to the first encrypted ballots.',
  active: 'Votes are encrypted and counted privately.',
  ended: 'Finalize to unlock public decryption.',
  finalized: 'Decrypt with the relayer and publish on-chain.',
  published: 'Tallies verified and stored on-chain.',
};

function isAddress(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function formatTimestamp(timestamp: bigint) {
  if (!timestamp) {
    return 'Not set';
  }

  const date = new Date(Number(timestamp) * 1000);
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatCountdown(target: number, now: number) {
  const diff = Math.max(target - now, 0);
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m`;
}

function getPhase(poll: PollRecord, nowMs: number): PollPhase {
  if (poll.resultsPublished) {
    return 'published';
  }
  if (poll.finalized) {
    return 'finalized';
  }
  const startMs = Number(poll.startTime) * 1000;
  const endMs = Number(poll.endTime) * 1000;

  if (nowMs < startMs) {
    return 'upcoming';
  }
  if (nowMs >= endMs) {
    return 'ended';
  }
  return 'active';
}

function toUnixSeconds(value: string) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return Math.floor(timestamp / 1000);
}

export function VoteApp() {
  const publicClient = usePublicClient();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const signerPromise = useEthersSigner();
  const { instance, isLoading: zamaLoading, error: zamaError } = useZamaInstance();

  const [contractAddress, setContractAddress] = useState(CONTRACT_ADDRESS);
  const [polls, setPolls] = useState<PollRecord[]>([]);
  const [voteSelections, setVoteSelections] = useState<Record<number, number>>({});
  const [decryptedResults, setDecryptedResults] = useState<Record<number, DecryptedResults>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const [title, setTitle] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  const activeAddress = useMemo(() => (isAddress(contractAddress) ? contractAddress : undefined), [contractAddress]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const pollStats = useMemo(() => {
    const total = polls.length;
    const active = polls.filter((poll) => getPhase(poll, now) === 'active').length;
    const upcoming = polls.filter((poll) => getPhase(poll, now) === 'upcoming').length;
    const finalized = polls.filter((poll) => poll.finalized).length;
    const published = polls.filter((poll) => poll.resultsPublished).length;
    return { total, active, upcoming, finalized, published };
  }, [polls, now]);

  const fetchPolls = useCallback(async () => {
    if (!publicClient || !activeAddress) {
      setPolls([]);
      return;
    }

    setLoading(true);
    setNotice(null);

    try {
      const count = (await publicClient.readContract({
        address: activeAddress,
        abi: CONTRACT_ABI,
        functionName: 'getPollCount',
      })) as bigint;

      const total = Number(count);
      const pollIds = Array.from({ length: total }, (_, index) => index);

      const fetched = await Promise.all(
        pollIds.map(async (pollId) => {
          const summary = (await publicClient.readContract({
            address: activeAddress,
            abi: CONTRACT_ABI,
            functionName: 'getPollSummary',
            args: [BigInt(pollId)],
          })) as readonly [string, bigint, bigint, bigint, boolean, boolean, `0x${string}`];

          const [pollTitle, start, end, optionCount, finalized, resultsPublished, creator] = summary;

          const pollOptions = (await publicClient.readContract({
            address: activeAddress,
            abi: CONTRACT_ABI,
            functionName: 'getPollOptions',
            args: [BigInt(pollId)],
          })) as string[];

          const userVoted = address
            ? ((await publicClient.readContract({
                address: activeAddress,
                abi: CONTRACT_ABI,
                functionName: 'hasUserVoted',
                args: [BigInt(pollId), address],
              })) as boolean)
            : false;

          let publishedResults: number[] | undefined;
          let publishedProof: `0x${string}` | undefined;

          if (resultsPublished) {
            const published = (await publicClient.readContract({
              address: activeAddress,
              abi: CONTRACT_ABI,
              functionName: 'getPublishedResults',
              args: [BigInt(pollId)],
            })) as readonly [readonly number[], `0x${string}`];

            publishedResults = published[0].map((value) => Number(value));
            publishedProof = published[1];
          }

          return {
            id: pollId,
            title: pollTitle,
            options: pollOptions,
            startTime: start,
            endTime: end,
            optionCount,
            finalized,
            resultsPublished,
            creator,
            userVoted,
            publishedResults,
            publishedProof,
          };
        }),
      );

      fetched.sort((a, b) => Number(b.endTime - a.endTime));
      setPolls(fetched);
    } catch (error) {
      console.error('Failed to fetch polls:', error);
      setNotice({ type: 'error', text: 'Unable to load polls from Sepolia. Check the address and try again.' });
    } finally {
      setLoading(false);
    }
  }, [activeAddress, address, publicClient]);

  useEffect(() => {
    fetchPolls();
  }, [fetchPolls, refreshNonce]);

  const refresh = () => setRefreshNonce((value) => value + 1);

  const ensureSepolia = () => {
    if (chainId !== SEPOLIA_CHAIN_ID) {
      setNotice({ type: 'error', text: 'Switch your wallet to Sepolia before submitting transactions.' });
      return false;
    }
    return true;
  };

  const handleCreatePoll = async () => {
    if (!activeAddress) {
      setNotice({ type: 'error', text: 'Set a valid MetaVote contract address first.' });
      return;
    }

    if (!isConnected) {
      setNotice({ type: 'error', text: 'Connect your wallet to create a poll.' });
      return;
    }
    if (!ensureSepolia()) {
      return;
    }

    const sanitizedOptions = options.map((option) => option.trim());
    if (!title.trim()) {
      setNotice({ type: 'error', text: 'Poll title is required.' });
      return;
    }
    if (sanitizedOptions.length < 2 || sanitizedOptions.length > 4) {
      setNotice({ type: 'error', text: 'Provide between 2 and 4 options.' });
      return;
    }
    if (sanitizedOptions.some((option) => !option)) {
      setNotice({ type: 'error', text: 'Option labels cannot be empty.' });
      return;
    }

    const start = toUnixSeconds(startTime);
    const end = toUnixSeconds(endTime);
    if (!start || !end) {
      setNotice({ type: 'error', text: 'Select a valid start and end time.' });
      return;
    }
    if (start >= end) {
      setNotice({ type: 'error', text: 'End time must be after start time.' });
      return;
    }
    if (end <= Math.floor(Date.now() / 1000)) {
      setNotice({ type: 'error', text: 'End time must be in the future.' });
      return;
    }

    if (!signerPromise) {
      setNotice({ type: 'error', text: 'Wallet signer not ready yet.' });
      return;
    }

    setPendingAction('create');
    try {
      const signer = await signerPromise;
      const contract = new Contract(activeAddress, CONTRACT_ABI, signer);
      const tx = await contract.createPoll(title.trim(), sanitizedOptions, BigInt(start), BigInt(end));
      await tx.wait();
      setNotice({ type: 'success', text: 'Poll created successfully.' });
      setTitle('');
      setOptions(['', '']);
      setStartTime('');
      setEndTime('');
      refresh();
    } catch (error) {
      console.error('Create poll failed:', error);
      setNotice({ type: 'error', text: 'Failed to create poll. Check your wallet and try again.' });
    } finally {
      setPendingAction(null);
    }
  };

  const handleVote = async (pollId: number) => {
    if (!activeAddress) {
      setNotice({ type: 'error', text: 'Set a valid MetaVote contract address first.' });
      return;
    }

    if (!address) {
      setNotice({ type: 'error', text: 'Connect your wallet to vote.' });
      return;
    }
    if (!ensureSepolia()) {
      return;
    }

    if (!instance) {
      setNotice({ type: 'error', text: 'Encryption service is not ready yet.' });
      return;
    }

    const choice = voteSelections[pollId];
    if (choice === undefined) {
      setNotice({ type: 'error', text: 'Select an option before voting.' });
      return;
    }

    if (!signerPromise) {
      setNotice({ type: 'error', text: 'Wallet signer not ready yet.' });
      return;
    }

    setPendingAction(`vote-${pollId}`);
    try {
      const input = instance.createEncryptedInput(activeAddress, address);
      input.add32(choice);
      const encrypted = await input.encrypt();

      const signer = await signerPromise;
      const contract = new Contract(activeAddress, CONTRACT_ABI, signer);
      const tx = await contract.castVote(pollId, encrypted.handles[0], encrypted.inputProof);
      await tx.wait();
      setNotice({ type: 'success', text: 'Encrypted vote submitted.' });
      refresh();
    } catch (error) {
      console.error('Vote failed:', error);
      setNotice({ type: 'error', text: 'Vote failed. Make sure the poll is active and try again.' });
    } finally {
      setPendingAction(null);
    }
  };

  const handleFinalize = async (pollId: number) => {
    if (!activeAddress) {
      setNotice({ type: 'error', text: 'Set a valid MetaVote contract address first.' });
      return;
    }
    if (!ensureSepolia()) {
      return;
    }
    if (!signerPromise) {
      setNotice({ type: 'error', text: 'Wallet signer not ready yet.' });
      return;
    }

    setPendingAction(`finalize-${pollId}`);
    try {
      const signer = await signerPromise;
      const contract = new Contract(activeAddress, CONTRACT_ABI, signer);
      const tx = await contract.finalizePoll(pollId);
      await tx.wait();
      setNotice({ type: 'success', text: 'Poll finalized. Tallies are now publicly decryptable.' });
      refresh();
    } catch (error) {
      console.error('Finalize failed:', error);
      setNotice({ type: 'error', text: 'Finalize failed. Ensure the poll has ended.' });
    } finally {
      setPendingAction(null);
    }
  };

  const handleDecrypt = async (pollId: number) => {
    if (!activeAddress) {
      setNotice({ type: 'error', text: 'Set a valid MetaVote contract address first.' });
      return;
    }
    if (!instance) {
      setNotice({ type: 'error', text: 'Encryption service is not ready yet.' });
      return;
    }
    if (!publicClient) {
      setNotice({ type: 'error', text: 'Public client not ready yet.' });
      return;
    }

    setPendingAction(`decrypt-${pollId}`);
    try {
      const handles = (await publicClient.readContract({
        address: activeAddress,
        abi: CONTRACT_ABI,
        functionName: 'getEncryptedTallies',
        args: [BigInt(pollId)],
      })) as readonly `0x${string}`[];

      const decrypted = await instance.publicDecrypt(handles);
      const clearTallies = handles.map((handle) => Number(decrypted.clearValues[handle] ?? 0));

      setDecryptedResults((prev) => ({
        ...prev,
        [pollId]: {
          tallies: clearTallies,
          proof: decrypted.decryptionProof,
        },
      }));

      setNotice({ type: 'success', text: 'Decryption completed. You can now publish results on-chain.' });
    } catch (error) {
      console.error('Decryption failed:', error);
      setNotice({ type: 'error', text: 'Decryption failed. Ensure the poll is finalized.' });
    } finally {
      setPendingAction(null);
    }
  };

  const handlePublish = async (pollId: number) => {
    if (!activeAddress) {
      setNotice({ type: 'error', text: 'Set a valid MetaVote contract address first.' });
      return;
    }
    if (!ensureSepolia()) {
      return;
    }
    if (!signerPromise) {
      setNotice({ type: 'error', text: 'Wallet signer not ready yet.' });
      return;
    }

    const decrypted = decryptedResults[pollId];
    if (!decrypted) {
      setNotice({ type: 'error', text: 'Decrypt results first before publishing.' });
      return;
    }

    setPendingAction(`publish-${pollId}`);
    try {
      const signer = await signerPromise;
      const contract = new Contract(activeAddress, CONTRACT_ABI, signer);
      const tx = await contract.publishResults(pollId, decrypted.tallies, decrypted.proof);
      await tx.wait();
      setNotice({ type: 'success', text: 'Results published on-chain.' });
      refresh();
    } catch (error) {
      console.error('Publish failed:', error);
      setNotice({ type: 'error', text: 'Publish failed. Verify the proof and try again.' });
    } finally {
      setPendingAction(null);
    }
  };

  const handleOptionChange = (index: number, value: string) => {
    setOptions((prev) => prev.map((option, idx) => (idx === index ? value : option)));
  };

  const addOption = () => {
    setOptions((prev) => (prev.length >= 4 ? prev : [...prev, '']));
  };

  const removeOption = (index: number) => {
    setOptions((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== index)));
  };

  return (
    <div className="vote-app">
      <Header />
      <main className="vote-main">
        <section className="hero">
          <div className="hero-copy">
            <p className="hero-kicker">Encrypted decision studio</p>
            <h2 className="hero-title">Launch private polls and reveal verified results on-chain.</h2>
            <p className="hero-subtitle">
              MetaVote uses FHE to keep every ballot confidential until the deadline, then makes tallies public with
              cryptographic proof.
            </p>
            <div className="hero-meta">
              <div>
                <span className="meta-label">Network</span>
                <span className="meta-value">Sepolia (FHEVM)</span>
              </div>
              <div>
                <span className="meta-label">Relayer</span>
                <span className="meta-value">Zama Public Decryption</span>
              </div>
            </div>
          </div>
          <div className="hero-stats">
            <div className="stat-card">
              <span className="stat-value">{pollStats.total}</span>
              <span className="stat-label">Total polls</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{pollStats.active}</span>
              <span className="stat-label">Live now</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{pollStats.finalized}</span>
              <span className="stat-label">Decryptable</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{pollStats.published}</span>
              <span className="stat-label">Published</span>
            </div>
          </div>
        </section>

        <section className="contract-panel">
          <div className="contract-field">
            <label htmlFor="contractAddress">MetaVote contract address</label>
            <input
              id="contractAddress"
              type="text"
              value={contractAddress}
              onChange={(event) => setContractAddress(event.target.value.trim())}
              placeholder="Paste the Sepolia deployment address"
            />
            <p className="helper-text">
              Use the address from `deployments/sepolia/MetaVote.json`. This is read directly from Sepolia.
            </p>
          </div>
          <div className="contract-status">
            <div>
              <span className="meta-label">Wallet</span>
              <span className="meta-value">{isConnected ? 'Connected' : 'Disconnected'}</span>
            </div>
            <div>
              <span className="meta-label">Chain</span>
              <span className="meta-value">{chainId === SEPOLIA_CHAIN_ID ? 'Sepolia' : 'Wrong network'}</span>
            </div>
            <div>
              <span className="meta-label">Contract</span>
              <span className="meta-value">{activeAddress ? 'Ready' : 'Missing'}</span>
            </div>
            <div>
              <span className="meta-label">Relayer</span>
              <span className="meta-value">{zamaLoading ? 'Connecting' : zamaError ? 'Unavailable' : 'Ready'}</span>
            </div>
          </div>
        </section>

        {notice && (
          <div className={`notice notice-${notice.type}`}>
            <span>{notice.text}</span>
          </div>
        )}

        {chainId !== SEPOLIA_CHAIN_ID && (
          <div className="notice notice-error">
            <span>Switch your wallet network to Sepolia to continue.</span>
          </div>
        )}

        <section className="board">
          <div className="create-card">
            <div className="card-header">
              <div>
                <h3>Create a poll</h3>
                <p>Define the question, set a window, and open confidential voting.</p>
              </div>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>Poll title</span>
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="e.g. Favorite launch theme"
                />
              </label>
              <div className="field-group">
                <span>Options</span>
                {options.map((option, index) => (
                  <div className="option-row" key={`option-${index}`}>
                    <input
                      type="text"
                      value={option}
                      onChange={(event) => handleOptionChange(index, event.target.value)}
                      placeholder={`Option ${index + 1}`}
                    />
                    {options.length > 2 && (
                      <button className="ghost" type="button" onClick={() => removeOption(index)}>
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                <button className="ghost" type="button" onClick={addOption} disabled={options.length >= 4}>
                  Add option
                </button>
              </div>
              <label className="field">
                <span>Start time</span>
                <input type="datetime-local" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
              </label>
              <label className="field">
                <span>End time</span>
                <input type="datetime-local" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
              </label>
            </div>
            <button className="primary" type="button" onClick={handleCreatePoll} disabled={pendingAction === 'create'}>
              {pendingAction === 'create' ? 'Creating...' : 'Create poll'}
            </button>
          </div>

          <div className="polls-card">
            <div className="card-header">
              <div>
                <h3>Live polls</h3>
                <p>Vote with encryption, finalize after the deadline, and publish verified results.</p>
              </div>
              <button className="ghost" type="button" onClick={refresh} disabled={loading}>
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
            {polls.length === 0 ? (
              <div className="empty-state">
                <h4>No polls found</h4>
                <p>Create the first poll or confirm the contract address.</p>
              </div>
            ) : (
              <div className="poll-grid">
                {polls.map((poll, index) => {
                  const phase = getPhase(poll, now);
                  const startMs = Number(poll.startTime) * 1000;
                  const endMs = Number(poll.endTime) * 1000;
                  const decrypted = decryptedResults[poll.id];
                  const published = poll.publishedResults;
                  const timeLabel =
                    phase === 'upcoming'
                      ? `Starts in ${formatCountdown(startMs, now)}`
                      : phase === 'active'
                        ? `Ends in ${formatCountdown(endMs, now)}`
                        : `Ended ${formatCountdown(now, endMs)} ago`;

                  return (
                    <article
                      className="poll-card"
                      key={`poll-${poll.id}`}
                      style={{ '--delay': index } as CSSProperties}
                    >
                      <div className="poll-header">
                        <div>
                          <h4>{poll.title}</h4>
                          <p className="poll-meta">Created by {poll.creator}</p>
                        </div>
                        <div className={`status-chip status-${phase}`}>
                          <span>{statusLabels[phase]}</span>
                        </div>
                      </div>
                      <p className="poll-status-text">{statusDescriptions[phase]}</p>
                      <div className="timeline">
                        <div>
                          <span className="meta-label">Starts</span>
                          <span className="meta-value">{formatTimestamp(poll.startTime)}</span>
                        </div>
                        <div>
                          <span className="meta-label">Ends</span>
                          <span className="meta-value">{formatTimestamp(poll.endTime)}</span>
                        </div>
                        <div>
                          <span className="meta-label">Countdown</span>
                          <span className="meta-value">{timeLabel}</span>
                        </div>
                      </div>

                      <div className="options">
                        {poll.options.map((option, optionIndex) => (
                          <label
                            key={`poll-${poll.id}-option-${optionIndex}`}
                            className={`option ${voteSelections[poll.id] === optionIndex ? 'selected' : ''}`}
                          >
                            <input
                              type="radio"
                              name={`poll-${poll.id}`}
                              value={optionIndex}
                              checked={voteSelections[poll.id] === optionIndex}
                              onChange={() =>
                                setVoteSelections((prev) => ({
                                  ...prev,
                                  [poll.id]: optionIndex,
                                }))
                              }
                              disabled={phase !== 'active' || poll.userVoted}
                            />
                            <span>{option}</span>
                          </label>
                        ))}
                      </div>

                      <div className="poll-actions">
                        {phase === 'active' && (
                          <button
                            className="primary"
                            type="button"
                            onClick={() => handleVote(poll.id)}
                            disabled={pendingAction === `vote-${poll.id}` || poll.userVoted}
                          >
                            {poll.userVoted
                              ? 'Vote recorded'
                              : pendingAction === `vote-${poll.id}`
                                ? 'Encrypting...'
                                : 'Encrypt & vote'}
                          </button>
                        )}

                        {phase === 'ended' && (
                          <button
                            className="primary"
                            type="button"
                            onClick={() => handleFinalize(poll.id)}
                            disabled={pendingAction === `finalize-${poll.id}`}
                          >
                            {pendingAction === `finalize-${poll.id}` ? 'Finalizing...' : 'Finalize poll'}
                          </button>
                        )}

                        {(phase === 'finalized' || phase === 'published') && (
                          <div className="result-actions">
                            <button
                              className="ghost"
                              type="button"
                              onClick={() => handleDecrypt(poll.id)}
                              disabled={pendingAction === `decrypt-${poll.id}`}
                            >
                              {pendingAction === `decrypt-${poll.id}` ? 'Decrypting...' : 'Decrypt results'}
                            </button>
                            <button
                              className="primary"
                              type="button"
                              onClick={() => handlePublish(poll.id)}
                              disabled={!decrypted || pendingAction === `publish-${poll.id}` || poll.resultsPublished}
                            >
                              {poll.resultsPublished
                                ? 'Published'
                                : pendingAction === `publish-${poll.id}`
                                  ? 'Publishing...'
                                  : 'Publish on-chain'}
                            </button>
                          </div>
                        )}
                      </div>

                      {(decrypted || published) && (
                        <div className="results">
                          <h5>Results</h5>
                          <div className="result-grid">
                            {poll.options.map((option, optionIndex) => {
                              const value = published
                                ? published[optionIndex] ?? 0
                                : decrypted
                                  ? decrypted.tallies[optionIndex] ?? 0
                                  : 0;
                              return (
                                <div key={`poll-${poll.id}-result-${optionIndex}`} className="result-item">
                                  <span className="result-label">{option}</span>
                                  <span className="result-value">{value}</span>
                                </div>
                              );
                            })}
                          </div>
                          {published && poll.publishedProof && (
                            <p className="proof">Proof: {poll.publishedProof}</p>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
