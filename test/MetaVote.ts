import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { MetaVote, MetaVote__factory } from "../types";

describe("MetaVote", function () {
  let deployer: HardhatEthersSigner;
  let voterA: HardhatEthersSigner;
  let voterB: HardhatEthersSigner;
  let metaVote: MetaVote;
  let metaVoteAddress: string;

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("MetaVote tests run only against the FHEVM mock environment");
      this.skip();
    }

    [deployer, voterA, voterB] = await ethers.getSigners();
    const factory = (await ethers.getContractFactory("MetaVote")) as MetaVote__factory;
    metaVote = (await factory.deploy()) as MetaVote;
    metaVoteAddress = await metaVote.getAddress();
  });

  async function createSamplePoll() {
    const now = BigInt(await time.latest());
    const start = now + 2n;
    const end = start + 300n;
    const tx = await metaVote.createPoll(
      "Favorite language",
      ["Solidity", "TypeScript", "Rust"],
      start,
      end,
    );
    await tx.wait();
    return { start, end };
  }

  it("creates polls, accepts encrypted votes, and publishes verified results", async function () {
    const { start, end } = await createSamplePoll();
    await time.increaseTo(Number(start + 1n));

    const encryptedChoiceA = await fhevm
      .createEncryptedInput(metaVoteAddress, voterA.address)
      .add32(1)
      .encrypt();
    await (await metaVote
      .connect(voterA)
      .castVote(0, encryptedChoiceA.handles[0], encryptedChoiceA.inputProof)).wait();

    const encryptedChoiceB = await fhevm
      .createEncryptedInput(metaVoteAddress, voterB.address)
      .add32(2)
      .encrypt();
    await (await metaVote
      .connect(voterB)
      .castVote(0, encryptedChoiceB.handles[0], encryptedChoiceB.inputProof)).wait();

    const hasVotedA = await metaVote.hasUserVoted(0, voterA.address);
    expect(hasVotedA).to.eq(true);

    await time.increaseTo(Number(end + 1n));
    await (await metaVote.finalizePoll(0)).wait();

    const tallies = await metaVote.getEncryptedTallies(0);
    const handles = tallies.map((h: string) => h);
    const decrypted = await fhevm.publicDecrypt(handles);
    const clearTallies = handles.map((handle) => Number(decrypted.clearValues[handle]));

    await (await metaVote.publishResults(0, clearTallies, decrypted.decryptionProof)).wait();
    const published = await metaVote.getPublishedResults(0);

    expect(published[0].map(Number)).to.deep.equal([0, 1, 1]);
    expect(published[1].length).to.be.greaterThan(0);
  });

  it("prevents double voting and enforces time windows", async function () {
    const { start, end } = await createSamplePoll();

    const encryptedChoice = await fhevm
      .createEncryptedInput(metaVoteAddress, voterA.address)
      .add32(0)
      .encrypt();

    await expect(
      metaVote.connect(voterA).castVote(0, encryptedChoice.handles[0], encryptedChoice.inputProof),
    ).to.be.reverted;

    await time.increaseTo(Number(start + 1n));

    await (await metaVote
      .connect(voterA)
      .castVote(0, encryptedChoice.handles[0], encryptedChoice.inputProof)).wait();

    await expect(
      metaVote.connect(voterA).castVote(0, encryptedChoice.handles[0], encryptedChoice.inputProof),
    ).to.be.reverted;

    await time.increaseTo(Number(end + 1n));
    await (await metaVote.finalizePoll(0)).wait();
    await expect(
      metaVote.connect(voterB).castVote(0, encryptedChoice.handles[0], encryptedChoice.inputProof),
    ).to.be.reverted;
  });
});
