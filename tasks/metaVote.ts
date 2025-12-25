import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

task("task:address", "Prints the MetaVote address").setAction(async function (_taskArguments: TaskArguments, hre) {
  const deployment = await hre.deployments.get("MetaVote");
  console.log(`MetaVote address: ${deployment.address}`);
});

task("task:create-poll", "Creates a new poll")
  .addParam("title", "Poll title")
  .addParam("options", "Comma separated options (2-4)")
  .addParam("start", "Start timestamp (seconds)")
  .addParam("end", "End timestamp (seconds)")
  .addOptionalParam("address", "Override MetaVote address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;
    const deployment = taskArguments.address
      ? { address: taskArguments.address as string }
      : await deployments.get("MetaVote");

    const options = (taskArguments.options as string).split(",").map((s) => s.trim());
    const startTime = BigInt(taskArguments.start);
    const endTime = BigInt(taskArguments.end);

    if (options.length < 2 || options.length > 4) {
      throw new Error("Provide between 2 and 4 options");
    }

    const [signer] = await ethers.getSigners();
    const contract = await ethers.getContractAt("MetaVote", deployment.address);

    const tx = await contract
      .connect(signer)
      .createPoll(taskArguments.title, options, startTime, endTime);
    console.log(`Creating poll... tx=${tx.hash}`);
    await tx.wait();
    console.log("Poll created");
  });

task("task:vote", "Cast an encrypted vote")
  .addParam("poll", "Poll id")
  .addParam("choice", "Option index (0-based)")
  .addOptionalParam("address", "Override MetaVote address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;
    const deployment = taskArguments.address
      ? { address: taskArguments.address as string }
      : await deployments.get("MetaVote");

    const pollId = parseInt(taskArguments.poll as string, 10);
    const choice = parseInt(taskArguments.choice as string, 10);

    const [signer] = await ethers.getSigners();
    const contract = await ethers.getContractAt("MetaVote", deployment.address);

    const encryptedChoice = await fhevm
      .createEncryptedInput(deployment.address, signer.address)
      .add32(choice)
      .encrypt();

    const tx = await contract
      .connect(signer)
      .castVote(pollId, encryptedChoice.handles[0], encryptedChoice.inputProof);
    console.log(`Casting vote... tx=${tx.hash}`);
    await tx.wait();
    console.log("Vote submitted");
  });

task("task:finalize", "Finalize a poll (make tallies publicly decryptable)")
  .addParam("poll", "Poll id")
  .addOptionalParam("address", "Override MetaVote address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;
    const deployment = taskArguments.address
      ? { address: taskArguments.address as string }
      : await deployments.get("MetaVote");

    const pollId = parseInt(taskArguments.poll as string, 10);
    const [signer] = await ethers.getSigners();
    const contract = await ethers.getContractAt("MetaVote", deployment.address);

    const tx = await contract.connect(signer).finalizePoll(pollId);
    console.log(`Finalizing poll... tx=${tx.hash}`);
    await tx.wait();
    console.log("Poll finalized");
  });

task("task:decrypt-results", "Decrypt public tallies for a poll")
  .addParam("poll", "Poll id")
  .addOptionalParam("address", "Override MetaVote address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;
    const deployment = taskArguments.address
      ? { address: taskArguments.address as string }
      : await deployments.get("MetaVote");

    const pollId = parseInt(taskArguments.poll as string, 10);
    const contract = await ethers.getContractAt("MetaVote", deployment.address);
    const tallies = await contract.getEncryptedTallies(pollId);

    const handles = tallies.map((h: string) => h);
    const decrypted = await fhevm.publicDecrypt(handles);

    console.log("Decryption proof:", decrypted.decryptionProof);
    handles.forEach((handle) => {
      const clear = decrypted.clearValues[handle];
      console.log(`Handle ${handle}: ${clear?.toString() ?? "unknown"}`);
    });
  });

task("task:publish-results", "Decrypt and publish results on-chain")
  .addParam("poll", "Poll id")
  .addOptionalParam("address", "Override MetaVote address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;
    const deployment = taskArguments.address
      ? { address: taskArguments.address as string }
      : await deployments.get("MetaVote");

    const pollId = parseInt(taskArguments.poll as string, 10);
    const contract = await ethers.getContractAt("MetaVote", deployment.address);
    const tallies = await contract.getEncryptedTallies(pollId);

    const handles = tallies.map((h: string) => h);
    const decrypted = await fhevm.publicDecrypt(handles);
    const clearTallies = handles.map((handle: string) => Number(decrypted.clearValues[handle]));

    const [signer] = await ethers.getSigners();
    const tx = await contract
      .connect(signer)
      .publishResults(pollId, clearTallies, decrypted.decryptionProof);
    console.log(`Publishing results... tx=${tx.hash}`);
    await tx.wait();
    console.log("Results published on-chain");
  });
