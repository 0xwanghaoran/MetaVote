import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedMetaVote = await deploy("MetaVote", {
    from: deployer,
    log: true,
  });

  console.log(`MetaVote contract: `, deployedMetaVote.address);
};
export default func;
func.id = "deploy_metaVote"; // id required to prevent reexecution
func.tags = ["MetaVote"];
