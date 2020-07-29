import { ethers } from 'ethers';
import { BigNumber } from 'ethers/utils';

import { Address, Position } from 'set-protocol-v2/utils/types';
import { Blockchain, ether } from 'set-protocol-v2/dist/utils/common';
import DeployHelper from 'set-protocol-v2/dist/utils/deploys';
import { SetTokenWrapper } from '../../../src/wrappers/set-protocol-v2/SetTokenWrapper';
import { SetToken } from 'set-protocol-v2/dist/typechain/SetToken';
import { Controller } from 'set-protocol-v2/dist/typechain/Controller';
import { StandardTokenMock } from 'set-protocol-v2/dist/typechain/StandardTokenMock';
import {
  ADDRESS_ZERO,
  EMPTY_BYTES,
  POSITION_STATE,
  MODULE_STATE,
} from 'set-protocol-v2/dist/utils/constants';
import { ContractTransaction } from 'ethers';

const provider = new ethers.providers.JsonRpcProvider('http://localhost:8545');
import { expect } from './utils/chai';

const blockchain = new Blockchain(provider);

describe('SetTokenWrapper', () => {
  let owner: Address;
  let manager: Address;
  let mockIssuanceModule: Address;
  let mockLockedModule: Address;
  let testAccount: Address;
  let randomAccount: Address;
  let setTokenWrapper: SetTokenWrapper;

  let deployer: DeployHelper;

  beforeEach(async () => {
    [
      owner,
      manager,
      mockIssuanceModule,
      testAccount,
    ] = await provider.listAccounts();

    setTokenWrapper = new SetTokenWrapper(provider);
    deployer = new DeployHelper(provider.getSigner(owner));
  });

  beforeEach(async () => {
    await blockchain.saveSnapshotAsync();
  });

  afterEach(async () => {
    await blockchain.revertAsync();
  });

  describe('when there is a deployed SetToken', () => {
    let setToken: SetToken;

    let subjectCaller: Address;
    let controller: Controller;
    let firstComponent: StandardTokenMock;
    let firstComponentUnits: BigNumber;
    let secondComponent: StandardTokenMock;
    let secondComponentUnits: BigNumber;

    let components: Address[];
    let units: BigNumber[];
    let modules: Address[];
    let name: string;
    let symbol: string;

    beforeEach(async () => {
      [
        owner,
        manager,
        mockIssuanceModule,
        mockLockedModule,
        testAccount,
        randomAccount,
      ] = await provider.listAccounts();

      firstComponent = await deployer.mocks.deployTokenMock(manager);
      firstComponentUnits = ether(1);
      secondComponent = await deployer.mocks.deployTokenMock(manager);
      secondComponentUnits = ether(2);

      controller = await deployer.core.deployController(owner);
      components = [firstComponent.address, secondComponent.address];
      units = [firstComponentUnits, secondComponentUnits];
      modules = [mockIssuanceModule, mockLockedModule];
      name = 'TestSetToken';
      symbol = 'SET';

      setToken = await deployer.core.deploySetToken(
        components,
        units,
        modules,
        controller.address,
        manager,
        name,
        symbol,
      );

      setToken = setToken.connect(provider.getSigner(mockIssuanceModule));
      await setToken.initializeModule();

      setToken = setToken.connect(provider.getSigner(mockLockedModule));
      await setToken.initializeModule();
    });

    describe('#addModule', () => {
      let subjectModule: Address;

      beforeEach(async () => {
        await controller.addModule(testAccount);

        subjectModule = testAccount;
        subjectCaller = manager;
      });

      async function subject(): Promise<ContractTransaction> {
        return setTokenWrapper.addModule(setToken.address, subjectModule, subjectCaller);
      }

      it('should change the state to pending', async () => {
        await subject();

        const moduleState = await setTokenWrapper.moduleStates(setToken.address, subjectModule);
        expect(moduleState).to.eq(MODULE_STATE['PENDING']);
      });

      describe('when the caller is not the manager', () => {
        beforeEach(async () => {
          subjectCaller = randomAccount;
        });

        it('should revert', async () => {
          try {
            await subject();
          } catch (err) {
            expect(err.responseText).to.include('Only manager can call');
          }
        });
      });

      describe('when the module is already added', () => {
        beforeEach(async () => {
          subjectModule = mockIssuanceModule;
          const moduleState = await setTokenWrapper.moduleStates(setToken.address, mockIssuanceModule);
        });

        it('should revert', async () => {
          try {
            await subject();
          } catch (err) {
            expect(err.responseText).to.include('Module must not be added');
          }
        });
      });

      describe('when the module is not enabled', () => {
        beforeEach(async () => {
          await controller.removeModule(subjectModule);
        });

        it('should revert', async () => {
          try {
            await subject();
          } catch (err) {
            expect(err.responseText).to.include('Must be enabled on Controller');
          }
        });
      });
    });

    describe('#setManager', () => {
      let subjectManager: Address;

      beforeEach(async () => {
        subjectManager = testAccount;
        subjectCaller = manager;
      });

      async function subject(): Promise<ContractTransaction> {
        return setTokenWrapper.setManager(setToken.address, subjectManager, subjectCaller);
      }

      it('should change the manager', async () => {
        await subject();

        const managerAddress = await setToken.manager();
        expect(managerAddress).to.eq(subjectManager);
      });

      describe('when the caller is not the manager', () => {
        beforeEach(async () => {
          subjectCaller = randomAccount;
        });

        it('should revert', async () => {
          try {
            await subject();
          } catch (err) {
            expect(err.responseText).to.include('Only manager can call');
          }
        });
      });
    });

    describe('#initializeModule', () => {
      let subjectModule: Address;

      beforeEach(async () => {
        subjectModule = testAccount;
        subjectCaller = testAccount;

        setToken = setToken.connect(provider.getSigner(manager));
        await controller.addModule(subjectModule);
        await setToken.addModule(subjectModule);
      });

      async function subject(): Promise<ContractTransaction> {
        return setTokenWrapper.initializeModule(setToken.address, subjectCaller);
      }

      it('should add the module to the modules list', async () => {
        await subject();

        const moduleList = await setToken.getModules();
        expect(moduleList).to.include(subjectModule);
      });

      it('should update the module state to initialized', async () => {
        await subject();

        const moduleState = await setTokenWrapper.moduleStates(setToken.address, subjectModule);
        expect(moduleState).to.eq(MODULE_STATE['INITIALIZED']);
      });

      describe('when the module is not added', () => {
        beforeEach(async () => {
          subjectCaller = owner;
        });

        it('should revert', async () => {
          try {
            await subject();
          } catch (err) {
            expect(err.responseText).to.include('Module must be pending');
          }
        });
      });

      describe('when the module already added', () => {
        beforeEach(async () => {
          subjectCaller = mockIssuanceModule;
        });

        it('should revert', async () => {
          try {
            await subject();
          } catch (err) {
            expect(err.responseText).to.include('Module must be pending');
          }
        });
      });

      describe('when the module is locked', () => {
        beforeEach(async () => {
          setToken = setToken.connect(provider.getSigner(mockIssuanceModule));
          await setToken.lock();
        });

        it('should revert', async () => {
          try {
            await subject();
          } catch (err) {
            expect(err.responseText).to.include('Only when unlocked');
          }
        });
      });
    });

    describe ('#getPositions', () => {
      beforeEach(async () => {
        subjectCaller = testAccount;
      });

      async function subject(): Promise<Position[]> {
        return await setTokenWrapper.getPositions(setToken.address, subjectCaller);
      }

      it('should return the correct Positions', async () => {
        const positions = await subject();

        const firstPosition = positions[0];
        expect(firstPosition.component).to.eq(firstComponent.address);
        expect(firstPosition.unit.toString()).to.eq(units[0].toString());
        expect(firstPosition.module).to.eq(ADDRESS_ZERO);
        expect(firstPosition.positionState).to.eq(POSITION_STATE['DEFAULT']);
        expect(firstPosition.data).to.eq(EMPTY_BYTES);

        const secondPosition = positions[1];
        expect(secondPosition.component).to.eq(secondComponent.address);
        expect(secondPosition.unit.toString()).to.eq(units[1].toString());
        expect(secondPosition.module).to.eq(ADDRESS_ZERO);
        expect(secondPosition.positionState).to.eq(POSITION_STATE['DEFAULT']);
        expect(secondPosition.data).to.eq(EMPTY_BYTES);
      });
    });

    describe('#getModules', () => {
      beforeEach(async () => {
        subjectCaller = testAccount;
      });

      async function subject(): Promise<Address[]> {
        return await setTokenWrapper.getModules(setToken.address, subjectCaller);
      }

      it('should return the correct modules', async () => {
        const moduleAddresses = await subject();

        expect(JSON.stringify(moduleAddresses)).to.eq(JSON.stringify(modules));
      });
    });
  });
});
