const { expect } = require('chai');
const { deploy } = require('../scripts/deploy.js');
const { readPrune, toBN } = require('../utils');
const { EXTERNAL, INTERNAL, INTERNAL_EXTERNAL, INTERNAL_TOLERANT } = require('./utils/balances.js')
const { BEAN, THREE_POOL, BEAN_3_CURVE, UNRIPE_LP, UNRIPE_BEAN, THREE_CURVE } = require('./utils/constants');
const { to18, to6, toStalk, toBean } = require('./utils/helpers.js')
const { takeSnapshot, revertToSnapshot } = require("./utils/snapshot");
const ZERO_BYTES = ethers.utils.formatBytes32String('0x0')

let user,user2,owner;
let userAddress, ownerAddress, user2Address;

let pru;

function pruneToSeeds(value, seeds = 2) {
  return prune(value).mul(seeds)
}

function pruneToStalk(value) {
  return prune(value).mul(toBN('10000'))
}

function prune(value) {
  return toBN(value).mul(toBN(pru)).div(to18('1'))
}

describe('Silo Token', function () {
  before(async function () {
    pru = await readPrune();
    [owner,user,user2] = await ethers.getSigners();
    userAddress = user.address;
    user2Address = user2.address;
    const contracts = await deploy("Test", false, true);
    ownerAddress = contracts.account;
    this.diamond = contracts.beanstalkDiamond;
    this.season = await ethers.getContractAt('MockSeasonFacet', this.diamond.address);
    this.silo = await ethers.getContractAt('MockSiloFacet', this.diamond.address);
    this.unripe = await ethers.getContractAt('MockUnripeFacet', this.diamond.address);

    this.threeCurve = await ethers.getContractAt('MockToken', THREE_CURVE);
    this.beanMetapool = await ethers.getContractAt('IMockCurvePool', BEAN_3_CURVE);
    await this.beanMetapool.set_supply(ethers.utils.parseUnits('2000000', 6));
    await this.beanMetapool.set_balances([
      ethers.utils.parseUnits('1000000',6),
      ethers.utils.parseEther('1000000')
    ]);

    const SiloToken = await ethers.getContractFactory("MockToken");
    this.siloToken = await SiloToken.deploy("Silo", "SILO")
    await this.siloToken.deployed()

    this.siloToken2 = await SiloToken.deploy("Silo", "SILO")
    await this.siloToken2.deployed()

    await this.silo.mockWhitelistToken(
      this.siloToken.address, 
      this.silo.interface.getSighash("mockBDV(uint256 amount)"), 
      '10000',
      '1');

    await this.season.siloSunrise(0);
    await this.siloToken.connect(user).approve(this.silo.address, '100000000000');
    await this.siloToken.connect(user2).approve(this.silo.address, '100000000000'); 
    await this.siloToken.mint(userAddress, '10000');
    await this.siloToken.mint(user2Address, '10000');
    await this.siloToken2.connect(user).approve(this.silo.address, '100000000000');
    await this.siloToken2.mint(userAddress, '10000');

    await this.siloToken.connect(owner).approve(this.silo.address, to18('10000')); 
    await this.siloToken.mint(ownerAddress, to18('10000'));

    this.unripeBeans = await ethers.getContractAt('MockToken', UNRIPE_BEAN);
    await this.unripeBeans.connect(user).mint(userAddress, to6('10000'))
    await this.unripeBeans.connect(user).approve(this.silo.address, to18('10000'))
    await this.unripe.addUnripeToken(UNRIPE_BEAN, this.siloToken.address, ZERO_BYTES)
    await this.unripe.connect(owner).addUnderlying(
      UNRIPE_BEAN,
      to6('10000').mul(toBN(pru)).div(to18('1'))
    )

    this.unripeLP = await ethers.getContractAt('MockToken', UNRIPE_LP);
    await this.unripeLP.connect(user).mint(userAddress, to6('10000'))
    await this.unripeLP.connect(user).approve(this.silo.address, to18('10000'))
    await this.unripe.addUnripeToken(UNRIPE_LP, this.siloToken.address, ZERO_BYTES)
    await this.unripe.connect(owner).addUnderlying(
      UNRIPE_LP,
      toBN(pru).mul(toBN('10000'))
    )

    this.beanThreeCurve = await ethers.getContractAt('MockMeta3Curve', BEAN_3_CURVE);
    await this.beanThreeCurve.set_supply(ethers.utils.parseEther('2000000'));
    await this.beanThreeCurve.set_balances([
      ethers.utils.parseUnits('1000000',6),
      ethers.utils.parseEther('1000000')
    ]);
    await this.beanThreeCurve.set_balances([
      ethers.utils.parseUnits('1200000',6),
      ethers.utils.parseEther('1000000')
    ]);
  });

  beforeEach(async function () {
    snapshotId = await takeSnapshot();
  });

  afterEach(async function () {
    await revertToSnapshot(snapshotId);
  });

  describe('deposit', function () {
    describe('reverts', function () {
      it('reverts if BDV is 0', async function () {
        await expect(this.silo.connect(user).deposit(this.siloToken.address, '0', EXTERNAL)).to.revertedWith('Silo: No Beans under Token.');
      });

      it('reverts if deposits a non whitelisted token', async function () {
        await expect(this.silo.connect(user).deposit(this.siloToken2.address, '0', EXTERNAL)).to.revertedWith('Diamond: Function does not exist');
      });
    });

    describe('single deposit', function () {
      beforeEach(async function () {
        this.result = await this.silo.connect(user).deposit(this.siloToken.address, '1000', EXTERNAL)
      });
  
      it('properly updates the total balances', async function () {
        expect(await this.silo.getTotalDeposited(this.siloToken.address)).to.eq('1000');
        expect(await this.silo.totalSeeds()).to.eq('1000');
        expect(await this.silo.totalStalk()).to.eq('10000000');
      });
  
      it('properly updates the user balance', async function () {
        expect(await this.silo.balanceOfSeeds(userAddress)).to.eq('1000');
        expect(await this.silo.balanceOfStalk(userAddress)).to.eq('10000000');
      });
  
      it('properly adds the crate', async function () {
        const deposit = await this.silo.getDeposit(userAddress, this.siloToken.address, 2);
        expect(deposit[0]).to.eq('1000');
        expect(deposit[1]).to.eq('1000');
      })

      it('emits Deposit event', async function () {
        await expect(this.result).to.emit(this.silo, 'AddDeposit').withArgs(userAddress, this.siloToken.address, 2, '1000', '1000');
      });
    });
  
    describe('2 deposits same season', function () {
      beforeEach(async function () {
        this.result = await this.silo.connect(user).deposit(this.siloToken.address, '1000', EXTERNAL)
        this.result = await this.silo.connect(user).deposit(this.siloToken.address, '1000', EXTERNAL)
      });
  
      it('properly updates the total balances', async function () {
        expect(await this.silo.getTotalDeposited(this.siloToken.address)).to.eq('2000');
        expect(await this.silo.totalSeeds()).to.eq('2000');
        expect(await this.silo.totalStalk()).to.eq('20000000');
      });
  
      it('properly updates the user balance', async function () {
        expect(await this.silo.balanceOfSeeds(userAddress)).to.eq('2000');
        expect(await this.silo.balanceOfStalk(userAddress)).to.eq('20000000');
      });
  
      it('properly adds the crate', async function () {
        const deposit = await this.silo.getDeposit(userAddress, this.siloToken.address, 2);
        expect(deposit[0]).to.eq('2000');
        expect(deposit[1]).to.eq('2000');
      })
    });
  
    describe('2 deposits 2 users', function () {
      beforeEach(async function () {
        this.result = await this.silo.connect(user).deposit(this.siloToken.address, '1000', EXTERNAL);
        this.result = await this.silo.connect(user2).deposit(this.siloToken.address, '1000', EXTERNAL);
      });
  
      it('properly updates the total balances', async function () {
        expect(await this.silo.getTotalDeposited(this.siloToken.address)).to.eq('2000');
        expect(await this.silo.totalSeeds()).to.eq('2000');
        expect(await this.silo.totalStalk()).to.eq('20000000');
      });
  
      it('properly updates the user balance', async function () {
        expect(await this.silo.balanceOfSeeds(userAddress)).to.eq('1000');
        expect(await this.silo.balanceOfStalk(userAddress)).to.eq('10000000');
      });
      it('properly updates the user2 balance', async function () {
        expect(await this.silo.balanceOfSeeds(user2Address)).to.eq('1000');
        expect(await this.silo.balanceOfStalk(user2Address)).to.eq('10000000');
      });
  
      it('properly adds the crate', async function () {
        let deposit = await this.silo.getDeposit(userAddress, this.siloToken.address, 2);
        expect(deposit[0]).to.eq('1000');
        expect(deposit[1]).to.eq('1000');
        deposit = await this.silo.getDeposit(user2Address, this.siloToken.address, 2);
        expect(deposit[0]).to.eq('1000');
        expect(deposit[1]).to.eq('1000');
      });
    });
  });

  describe('withdraw', function () {
    beforeEach(async function () {
      await this.silo.connect(user).deposit(this.siloToken.address, '1000', EXTERNAL);
    })
    describe('reverts', function () {
      it('reverts if amount is 0', async function () {
        await expect(this.silo.connect(user).withdrawDeposit(this.siloToken.address, '2', '1001')).to.revertedWith('Silo: Crate balance too low.');
      });

      it('reverts if deposits + withdrawals is a different length', async function () {
        await expect(this.silo.connect(user).withdrawDeposits(this.siloToken.address, ['2', '3'], ['1001'])).to.revertedWith('Silo: Crates, amounts are diff lengths.');
      });
    });

    describe('withdraw token by season', async function () {
      describe('withdraw 1 Bean crate', async function () {
        beforeEach(async function () {
          this.result = await this.silo.connect(user).withdrawDeposit(this.siloToken.address, 2, '1000');
        });
    
        it('properly updates the total balances', async function () {
          expect(await this.silo.getTotalDeposited(this.siloToken.address)).to.eq('0');
          expect(await this.silo.totalStalk()).to.eq('0');
          expect(await this.silo.totalSeeds()).to.eq('0');
          expect(await this.silo.getTotalWithdrawn(this.siloToken.address)).to.eq('1000');
        });
        it('properly updates the user balance', async function () {
          expect(await this.silo.balanceOfStalk(userAddress)).to.eq('0');
          expect(await this.silo.balanceOfSeeds(userAddress)).to.eq('0');
        });

        it('properly removes the deposit', async function () {
          const deposit = await this.silo.getDeposit(userAddress, this.siloToken.address, 2);
          expect(deposit[0]).to.eq('0');
          expect(deposit[1]).to.eq('0');
        });

        it('properly adds the withdrawal', async function () {
          expect(await this.silo.getWithdrawal(userAddress, this.siloToken.address, 27)).to.eq('1000');
        });
    
        it('emits Remove and Withdrawal event', async function () {
          await expect(this.result).to.emit(this.silo, 'RemoveDeposit').withArgs(userAddress, this.siloToken.address, 2, '1000');
          await expect(this.result).to.emit(this.silo, 'AddWithdrawal').withArgs(userAddress, this.siloToken.address, 27, '1000');
        });
      });
      
      describe('withdraw part of a bean crate', function () {
        beforeEach(async function () {
          this.result = await this.silo.connect(user).withdrawDeposit(this.siloToken.address, 2, '500');
        });
    
        it('properly updates the total balances', async function () {
          expect(await this.silo.getTotalDeposited(this.siloToken.address)).to.eq('500');
          expect(await this.silo.totalStalk()).to.eq('5000000');
          expect(await this.silo.totalSeeds()).to.eq('500');
          expect(await this.silo.getTotalWithdrawn(this.siloToken.address)).to.eq('500');
        });
        it('properly updates the user balance', async function () {
          expect(await this.silo.balanceOfStalk(userAddress)).to.eq('5000000');
          expect(await this.silo.balanceOfSeeds(userAddress)).to.eq('500');
        });

        it('properly removes the deposit', async function () {
          const deposit = await this.silo.getDeposit(userAddress, this.siloToken.address, 2);
          expect(deposit[0]).to.eq('500');
          expect(deposit[1]).to.eq('500');
        });

        it('properly adds the withdrawal', async function () {
          expect(await this.silo.getWithdrawal(userAddress, this.siloToken.address, 27)).to.eq('500');
        });

        it('emits Remove and Withdrawal event', async function () {
          await expect(this.result).to.emit(this.silo, 'RemoveDeposit').withArgs(userAddress, this.siloToken.address, 2, '500');
          await expect(this.result).to.emit(this.silo, 'AddWithdrawal').withArgs(userAddress, this.siloToken.address, 27, '500');
        });
      });
    });

    describe("withdraw token by seasons", async function (){
      describe('1 full and 1 partial token crates', function () {
        beforeEach(async function () {
          await this.season.siloSunrise(0);
          await this.silo.connect(user).deposit(this.siloToken.address, '1000', EXTERNAL);
          this.result = await this.silo.connect(user).withdrawDeposits(this.siloToken.address, [2,3],['500','1000']);
        });
    
        it('properly updates the total balances', async function () {
          expect(await this.silo.getTotalDeposited(this.siloToken.address)).to.eq('500');
          expect(await this.silo.totalStalk()).to.eq('5000500');
          expect(await this.silo.totalSeeds()).to.eq('500');
          expect(await this.silo.getTotalWithdrawn(this.siloToken.address)).to.eq('1500');
        });
        it('properly updates the user balance', async function () {
          expect(await this.silo.balanceOfStalk(userAddress)).to.eq('5000500');
          expect(await this.silo.balanceOfSeeds(userAddress)).to.eq('500');
        });
        it('properly removes the crate', async function () {
          let dep = await this.silo.getDeposit(userAddress, this.siloToken.address, 2);
          expect(dep[0]).to.equal('500')
          expect(dep[1]).to.equal('500')
          dep = await this.silo.getDeposit(userAddress, this.siloToken.address, 3);
          expect(dep[0]).to.equal('0')
          expect(dep[1]).to.equal('0')
        });
        it('emits Remove and Withdrawal event', async function () {
          await expect(this.result).to.emit(this.silo, 'RemoveDeposits').withArgs(userAddress, this.siloToken.address, [2,3], ['500', '1000'], '1500');
          await expect(this.result).to.emit(this.silo, 'AddWithdrawal').withArgs(userAddress, this.siloToken.address, 28, '1500');
        });
      });
      describe('2 token crates', function () {
        beforeEach(async function () {
          await this.season.siloSunrise(0);
          await this.silo.connect(user).deposit(this.siloToken.address, '1000', EXTERNAL);
          this.result = await this.silo.connect(user).withdrawDeposits(this.siloToken.address, [2,3],['1000','1000']);
        });
    
        it('properly updates the total balances', async function () {
          expect(await this.silo.getTotalDeposited(this.siloToken.address)).to.eq('0');
          expect(await this.silo.totalStalk()).to.eq('0');
          expect(await this.silo.totalSeeds()).to.eq('0');
          expect(await this.silo.getTotalWithdrawn(this.siloToken.address)).to.eq('2000');
        });
        it('properly updates the user balance', async function () {
          expect(await this.silo.balanceOfStalk(userAddress)).to.eq('0');
          expect(await this.silo.balanceOfSeeds(userAddress)).to.eq('0');
        });
        it('properly removes the crate', async function () {
          let dep = await this.silo.getDeposit(userAddress, this.siloToken.address, 2);
          expect(dep[0]).to.equal('0')
          expect(dep[1]).to.equal('0')
          dep = await this.silo.getDeposit(userAddress, this.siloToken.address, 3);
          expect(dep[0]).to.equal('0')
          expect(dep[1]).to.equal('0')
        });
        it('emits Remove and Withdrawal event', async function () {
          await expect(this.result).to.emit(this.silo, 'RemoveDeposits').withArgs(userAddress, this.siloToken.address, [2,3], ['1000', '1000'], '2000');
          await expect(this.result).to.emit(this.silo, 'AddWithdrawal').withArgs(userAddress, this.siloToken.address, 28, '2000');
        });
      });
    });
  });

  describe('claim', function () {
    beforeEach(async function () {
      await this.silo.connect(user).deposit(this.siloToken.address, '1000', EXTERNAL);
      await this.silo.connect(user).withdrawDeposit(this.siloToken.address, '2', '1000');
      await this.season.fastForward(25);
    })

    describe('claim token by season', function () {
      beforeEach(async function () {
        const userTokensBefore = await this.siloToken.balanceOf(userAddress);
        this.result = await this.silo.connect(user).claimWithdrawal(this.siloToken.address, 27, EXTERNAL);
        this.deltaBeans = (await this.siloToken.balanceOf(userAddress)).sub(userTokensBefore);
      });

      it('properly updates the total balances', async function () {
        expect(await this.silo.getTotalWithdrawn(this.siloToken.address)).to.eq('0');
        expect(this.deltaBeans).to.equal('1000');
      });

      it('properly removes the withdrawal', async function () {
        expect(await this.silo.getWithdrawal(userAddress, this.siloToken.address, 27)).to.eq('0');
      });

      it('emits a claim ', async function () {
        await expect(this.result).to.emit(this.silo, 'RemoveWithdrawal').withArgs(userAddress, this.siloToken.address, 27, '1000');
      });
    });

    describe('claim token by seasons', function () {
      beforeEach(async function () {
        await this.silo.connect(user).deposit(this.siloToken.address, '1000', EXTERNAL);
        await this.silo.connect(user).withdrawDeposit(this.siloToken.address, '27', '1000');
        await this.season.fastForward(25);

      const userTokensBefore = await this.siloToken.balanceOf(userAddress);
        this.result = await this.silo.connect(user).claimWithdrawals(this.siloToken.address, [27, 52], EXTERNAL);
        this.deltaBeans = (await this.siloToken.balanceOf(userAddress)).sub(userTokensBefore);
      });

      it('properly updates the total balances', async function () {
        expect(await this.silo.getTotalWithdrawn(this.siloToken.address)).to.eq('0');
        expect(this.deltaBeans).to.equal('2000');
      });

      it('properly removes the withdrawal', async function () {
        expect(await this.silo.getWithdrawal(userAddress, this.siloToken.address, 27)).to.eq('0');
      });

      it('emits a claim ', async function () {
        await expect(this.result).to.emit(this.silo, 'RemoveWithdrawals').withArgs(userAddress, this.siloToken.address, [27, 52], '2000');
      });
    });
  });

  describe("Curve BDV", async function () {
    before(async function () {
      this.threePool = await ethers.getContractAt('Mock3Curve', THREE_POOL);
      await this.threePool.set_virtual_price(ethers.utils.parseEther('1'));
      this.beanThreeCurve = await ethers.getContractAt('MockMeta3Curve', BEAN_3_CURVE);
      await this.beanThreeCurve.set_supply(ethers.utils.parseEther('2000000'));
      await this.beanThreeCurve.set_A_precise('1000');
      await this.beanThreeCurve.set_virtual_price(ethers.utils.parseEther('1'));
      await this.beanThreeCurve.set_balances([
        ethers.utils.parseUnits('1000000',6),
        ethers.utils.parseEther('1000000')
      ]);
      await this.beanThreeCurve.set_balances([
        ethers.utils.parseUnits('1200000',6),
        ethers.utils.parseEther('1000000')
      ]);
    });

    it("properly checks bdv", async function () {
      this.curveBDV = await ethers.getContractAt('BDVFacet', this.diamond.address);
      expect(await this.curveBDV.curveToBDV(ethers.utils.parseEther('200'))).to.equal(ethers.utils.parseUnits('200',6));
    })

    it("properly checks bdv", async function () {
      await this.threePool.set_virtual_price(ethers.utils.parseEther('1.02'));
      this.curveBDV = await ethers.getContractAt('BDVFacet', this.diamond.address);
      expect(await this.curveBDV.curveToBDV(ethers.utils.parseEther('2'))).to.equal('1998191');
    })
  })

  describe('Withdraw Unripe Beans', async function () {
    describe("Just legacy Bean Deposit", async function () {
      beforeEach(async function () {
        await this.silo.connect(user).mockUnripeBeanDeposit('2', to6('10'))
      })

      it("Check mock works", async function () {
        expect(await this.silo.getTotalDeposited(UNRIPE_BEAN)).to.eq(to6('10'));
        expect(await this.silo.totalStalk()).to.eq(pruneToStalk(to6('10')));
        expect(await this.silo.totalSeeds()).to.eq(pruneToSeeds(to6('10')));
      })

      it('get Deposit', async function () {
        const deposit = await this.silo.getDeposit(user.address, UNRIPE_BEAN, '2')
        expect(deposit[0]).to.equal(to6('10'))
        expect(deposit[1]).to.equal(prune(to6('10')))
      })
      
      it('revert if withdrawn too much', async function () {
        await expect(this.silo.connect(user).withdrawDeposit(UNRIPE_BEAN, '2', to6('11'))).to.be.revertedWith('Silo: Crate balance too low.')
      });
      
      describe("Withdraw", async function () {
        beforeEach(async function () {
          this.result = await this.silo.connect(user).withdrawDeposit(UNRIPE_BEAN, '2', to6('1'))
        })

        it('properly updates the total balances', async function () {
          expect(await this.silo.getTotalDeposited(UNRIPE_BEAN)).to.eq(to6('9'));
          expect(await this.silo.totalStalk()).to.eq(pruneToStalk(to6('9')));
          expect(await this.silo.totalSeeds()).to.eq(pruneToSeeds(to6('9')));
          expect(await this.silo.getTotalWithdrawn(UNRIPE_BEAN)).to.eq(to6('1'));
        });
        it('properly updates the user balance', async function () {
          expect(await this.silo.balanceOfStalk(userAddress)).to.eq(pruneToStalk(to6('9')));
          expect(await this.silo.balanceOfSeeds(userAddress)).to.eq(pruneToSeeds(to6('9')));
        });
        it('properly removes the crate', async function () {
          let dep = await this.silo.getDeposit(userAddress, UNRIPE_BEAN, 2);
          expect(dep[0]).to.equal(to6('9'))
          expect(dep[1]).to.equal(prune(to6('9')))
        });
        it('emits Remove and Withdrawal event', async function () {
          await expect(this.result).to.emit(this.silo, 'RemoveDeposit').withArgs(userAddress, UNRIPE_BEAN, 2, to6('1'));
          await expect(this.result).to.emit(this.silo, 'AddWithdrawal').withArgs(userAddress, UNRIPE_BEAN, 27, to6('1'));
        });
      })
    })
    describe("Legacy and new Bean Deposit", async function () {
      beforeEach(async function () {
        await this.silo.connect(user).deposit(UNRIPE_BEAN, to6('10'), EXTERNAL)
        await this.silo.connect(user).mockUnripeBeanDeposit('2', to6('10'))
      })

      it("Check mock works", async function () {
        expect(await this.silo.getTotalDeposited(UNRIPE_BEAN)).to.eq(to6('20'));
        expect(await this.silo.totalStalk()).to.eq(pruneToStalk(to6('10')).add(pruneToStalk(to6('10'))));
        expect(await this.silo.totalSeeds()).to.eq(pruneToSeeds(to6('10')).add(pruneToSeeds(to6('10'))));
      })

      it('get Deposit', async function () {
        const deposit = await this.silo.getDeposit(user.address, UNRIPE_BEAN, '2')
        expect(deposit[0]).to.equal(to6('20'))
        expect(deposit[1]).to.equal(prune(to6('10')).add(prune(to6('10'))))
      })
      
      it('revert if withdrawn too much', async function () {
        await expect(this.silo.connect(user).withdrawDeposit(UNRIPE_BEAN, '2', to6('21'))).to.be.revertedWith('Silo: Crate balance too low.')
      });
      
      describe("Withdraw", async function () {
        beforeEach(async function () {
          this.result = await this.silo.connect(user).withdrawDeposit(UNRIPE_BEAN, '2', to6('11'))
        })

        it('properly updates the total balances', async function () {
          expect(await this.silo.getTotalDeposited(UNRIPE_BEAN)).to.eq(to6('9'));
          expect(await this.silo.totalStalk()).to.eq(pruneToStalk(to6('9')));
          expect(await this.silo.totalSeeds()).to.eq(pruneToSeeds(to6('9')));
          expect(await this.silo.getTotalWithdrawn(UNRIPE_BEAN)).to.eq(to6('11'));
        });
        it('properly updates the user balance', async function () {
          expect(await this.silo.balanceOfStalk(userAddress)).to.eq(pruneToStalk(to6('9')));
          expect(await this.silo.balanceOfSeeds(userAddress)).to.eq(pruneToSeeds(to6('9')));
        });
        it('properly removes the crate', async function () {
          let dep = await this.silo.getDeposit(userAddress, UNRIPE_BEAN, 2);
          expect(dep[0]).to.equal(to6('9'))
          expect(dep[1]).to.equal(prune(to6('9')))
        });
        it('emits Remove and Withdrawal event', async function () {
          await expect(this.result).to.emit(this.silo, 'RemoveDeposit').withArgs(userAddress, UNRIPE_BEAN, 2, to6('11'));
          await expect(this.result).to.emit(this.silo, 'AddWithdrawal').withArgs(userAddress, UNRIPE_BEAN, 27, to6('11'));
        });
      })
    })
  });

  describe('Withdraw Unripe LP from BDV', async function () {
    describe("Just legacy LP Deposit BDV", async function () {
      beforeEach(async function () {
        await this.silo.connect(user).mockUnripeLPDeposit('0', '2', to18('0.000000083406453'), to6('10'))
      })

      it("Check mock works", async function () {
        expect(await this.silo.getTotalDeposited(UNRIPE_LP)).to.eq(to6('10'));
        expect(await this.silo.totalStalk()).to.eq(pruneToStalk(to6('10')));
        expect(await this.silo.totalSeeds()).to.eq(pruneToSeeds(to6('10'), 4));
      })

      it('get Deposit', async function () {
        const deposit = await this.silo.getDeposit(user.address, UNRIPE_LP, '2')
        expect(deposit[0]).to.equal(to6('10'))
        expect(deposit[1]).to.equal(prune(to6('10')))
      })
      
      it('revert if withdrawn too much', async function () {
        await expect(this.silo.connect(user).withdrawDeposit(UNRIPE_LP, '2', to6('11'))).to.be.revertedWith('Silo: Crate balance too low.')
      });
      
      describe("Withdraw", async function () {
        beforeEach(async function () {
          this.result = await this.silo.connect(user).withdrawDeposit(UNRIPE_LP, '2', to6('1'))
        })

        it('properly updates the total balances', async function () {
          expect(await this.silo.getTotalDeposited(UNRIPE_LP)).to.eq(to6('9'));
          expect(await this.silo.totalStalk()).to.eq(pruneToStalk(to6('9')));
          expect(await this.silo.totalSeeds()).to.eq(pruneToSeeds(to6('9'), 4));
          expect(await this.silo.getTotalWithdrawn(UNRIPE_LP)).to.eq(to6('1'));
        });

        it('properly updates the user balance', async function () {
          expect(await this.silo.balanceOfStalk(userAddress)).to.eq(pruneToStalk(to6('9')));
          expect(await this.silo.balanceOfSeeds(userAddress)).to.eq(pruneToSeeds(to6('9'), 4));
        });

        it('properly removes the crate', async function () {
          let dep = await this.silo.getDeposit(userAddress, UNRIPE_LP, 2);
          expect(dep[0]).to.equal(to6('9'))
          expect(dep[1]).to.equal(prune(to6('9')))
        });

        it('emits Remove and Withdrawal event', async function () {
          await expect(this.result).to.emit(this.silo, 'RemoveDeposit').withArgs(userAddress, UNRIPE_LP, 2, to6('1'));
          await expect(this.result).to.emit(this.silo, 'AddWithdrawal').withArgs(userAddress, UNRIPE_LP, 27, to6('1'));
        });
      })
    })
  
    describe("Just 3CRV LP Deposit", async function () {
      beforeEach(async function () {
        await this.silo.connect(user).mockUnripeLPDeposit('1', '2', to18('10.08028951'), to6('10'))
      })

      it("Check mock works", async function () {
        expect(await this.silo.getTotalDeposited(UNRIPE_LP)).to.eq(to6('10'));
        expect(await this.silo.totalStalk()).to.eq(pruneToStalk(to6('10')));
        expect(await this.silo.totalSeeds()).to.eq(pruneToSeeds(to6('10'), 4));
      })

      it('get Deposit', async function () {
        const deposit = await this.silo.getDeposit(user.address, UNRIPE_LP, '2')
        expect(deposit[0]).to.equal(to6('10'))
        expect(deposit[1]).to.equal(prune(to6('10')))
      })
      
      it('revert if withdrawn too much', async function () {
        await expect(this.silo.connect(user).withdrawDeposit(UNRIPE_LP, '2', to6('11'))).to.be.revertedWith('Silo: Crate balance too low.')
      });
      
      describe("Withdraw", async function () {
        beforeEach(async function () {
          this.result = await this.silo.connect(user).withdrawDeposit(UNRIPE_LP, '2', to6('1'))
        })

        it('properly updates the total balances', async function () {
          expect(await this.silo.getTotalDeposited(UNRIPE_LP)).to.eq(to6('9'));
          expect(await this.silo.totalStalk()).to.eq(pruneToStalk(to6('9')));
          expect(await this.silo.totalSeeds()).to.eq(pruneToSeeds(to6('9'), 4));
          expect(await this.silo.getTotalWithdrawn(UNRIPE_LP)).to.eq(to6('1'));
        });

        it('properly updates the user balance', async function () {
          expect(await this.silo.balanceOfStalk(userAddress)).to.eq(pruneToStalk(to6('9')));
          expect(await this.silo.balanceOfSeeds(userAddress)).to.eq(pruneToSeeds(to6('9'), 4));
        });

        it('properly removes the crate', async function () {
          let dep = await this.silo.getDeposit(userAddress, UNRIPE_LP, 2);
          expect(dep[0]).to.equal(to6('9'))
          expect(dep[1]).to.equal(prune(to6('9')))
        });

        it('emits Remove and Withdrawal event', async function () {
          await expect(this.result).to.emit(this.silo, 'RemoveDeposit').withArgs(userAddress, UNRIPE_LP, 2, to6('1'));
          await expect(this.result).to.emit(this.silo, 'AddWithdrawal').withArgs(userAddress, UNRIPE_LP, 27, to6('1'));
        });
      })
    })

    describe("Just BEAN:LUSD LP Deposit", async function () {
      beforeEach(async function () {
        await this.silo.connect(user).mockUnripeLPDeposit('2', '2', to18('10.17182243'), to6('10'))
      })

      it("Check mock works", async function () {
        expect(await this.silo.getTotalDeposited(UNRIPE_LP)).to.eq(to6('10'));
        expect(await this.silo.totalStalk()).to.eq(pruneToStalk(to6('10')));
        expect(await this.silo.totalSeeds()).to.eq(pruneToSeeds(to6('10'), 4));
      })

      it('get Deposit', async function () {
        const deposit = await this.silo.getDeposit(user.address, UNRIPE_LP, '2')
        expect(deposit[0]).to.equal(to6('10'))
        expect(deposit[1]).to.equal(prune(to6('10')))
      })
      
      it('revert if withdrawn too much', async function () {
        await expect(this.silo.connect(user).withdrawDeposit(UNRIPE_LP, '2', to6('11'))).to.be.revertedWith('Silo: Crate balance too low.')
      });
      
      describe("Withdraw", async function () {
        beforeEach(async function () {
          this.result = await this.silo.connect(user).withdrawDeposit(UNRIPE_LP, '2', to6('1'))
        })

        it('properly updates the total balances', async function () {
          expect(await this.silo.getTotalDeposited(UNRIPE_LP)).to.eq(to6('9'));
          expect(await this.silo.totalStalk()).to.eq(pruneToStalk(to6('9')));
          expect(await this.silo.totalSeeds()).to.eq(pruneToSeeds(to6('9'), 4));
          expect(await this.silo.getTotalWithdrawn(UNRIPE_LP)).to.eq(to6('1'));
        });

        it('properly updates the user balance', async function () {
          expect(await this.silo.balanceOfStalk(userAddress)).to.eq(pruneToStalk(to6('9')));
          expect(await this.silo.balanceOfSeeds(userAddress)).to.eq(pruneToSeeds(to6('9'), 4));
        });

        it('properly removes the crate', async function () {
          let dep = await this.silo.getDeposit(userAddress, UNRIPE_LP, 2);
          expect(dep[0]).to.equal(to6('9'))
          expect(dep[1]).to.equal(prune(to6('9')))
        });

        it('emits Remove and Withdrawal event', async function () {
          await expect(this.result).to.emit(this.silo, 'RemoveDeposit').withArgs(userAddress, UNRIPE_LP, 2, to6('1'));
          await expect(this.result).to.emit(this.silo, 'AddWithdrawal').withArgs(userAddress, UNRIPE_LP, 27, to6('1'));
        });
      })
    })

    describe("All 4 LP Deposit", async function () {
      beforeEach(async function () {
        await this.silo.connect(user).mockUnripeLPDeposit('0', '2', to18('0.000000020851613'), to6('2.5'))
        await this.silo.connect(user).mockUnripeLPDeposit('1', '2', to18('2.5200723775'), to6('2.5'))
        await this.silo.connect(user).mockUnripeLPDeposit('2', '2', to18('2.5429556075'), to6('2.5'))
        await this.silo.connect(user).deposit(UNRIPE_LP, to6('2.5'), EXTERNAL)
      })

      it("Check mock works", async function () {
        expect(await this.silo.getTotalDeposited(UNRIPE_LP)).to.eq(to6('10'));
        expect(await this.silo.totalStalk()).to.eq(pruneToStalk(to6('2.5')).mul(toBN('4')).sub(toBN('10000')));
        expect(await this.silo.totalSeeds()).to.eq(pruneToSeeds(to6('2.5'), 4).mul(toBN('4')).sub(toBN('4')));
      })

      it('get Deposit', async function () {
        const deposit = await this.silo.getDeposit(user.address, UNRIPE_LP, '2')
        expect(deposit[0]).to.equal(to6('10'))
        expect(deposit[1]).to.equal(prune(to6('7.5')).add(prune(to6('2.5'))).sub(toBN('1')))
      })
      
      it('revert if withdrawn too much', async function () {
        await expect(this.silo.connect(user).withdrawDeposit(UNRIPE_LP, '2', to6('11'))).to.be.revertedWith('Silo: Crate balance too low.')
      });
      
      describe("Withdraw", async function () {
        beforeEach(async function () {
          this.result = await this.silo.connect(user).withdrawDeposit(UNRIPE_LP, '2', to6('9'))
        })

        it('properly updates the total balances', async function () {
          expect(await this.silo.getTotalDeposited(UNRIPE_LP)).to.eq(to6('1'));
          expect(await this.silo.totalStalk()).to.eq(pruneToStalk(to6('1')).sub(toBN('10000')));
          expect(await this.silo.totalSeeds()).to.eq(pruneToSeeds(to6('1'), 4).sub(toBN('4')));
          expect(await this.silo.getTotalWithdrawn(UNRIPE_LP)).to.eq(to6('9'));
        });

        it('properly updates the user balance', async function () {
          expect(await this.silo.balanceOfStalk(userAddress)).to.eq(pruneToStalk(to6('1')).sub(toBN('10000')));
          expect(await this.silo.balanceOfSeeds(userAddress)).to.eq(pruneToSeeds(to6('1'), 4).sub(toBN('4')));
        });

        it('properly removes the crate', async function () {
          let dep = await this.silo.getDeposit(userAddress, UNRIPE_LP, 2);
          expect(dep[0]).to.equal(to6('1'))
          expect(dep[1]).to.equal(prune(to6('1')))
        });

        it('emits Remove and Withdrawal event', async function () {
          await expect(this.result).to.emit(this.silo, 'RemoveDeposit').withArgs(userAddress, UNRIPE_LP, 2, to6('9'));
          await expect(this.result).to.emit(this.silo, 'AddWithdrawal').withArgs(userAddress, UNRIPE_LP, 27, to6('9'));
        });
      })
    })
  })

  describe("Transfer", async function () {
    describe("reverts", async function() {
      beforeEach(async function () {
        await this.silo.connect(user).deposit(this.siloToken.address, '100', EXTERNAL)
        await this.season.siloSunrise('0')
        await this.silo.connect(user).deposit(this.siloToken.address, '100', EXTERNAL)
      })

      it('reverts if the amounts array is empty', async function () {
        await expect(this.silo.connect(user).transferDeposits(userAddress, user2Address, this.siloToken.address, [], [])).to.revertedWith('Silo: amounts array is empty');
      })

      it('reverts if the amount in array is 0', async function () {
        await expect(this.silo.connect(user).transferDeposits(userAddress, user2Address, this.siloToken.address, ['2', '3'], ['100', '0'])).to.revertedWith('Silo: amount in array is 0');
      })
    })
    describe("Single", async function () {
      
      it('returns the correct value', async function () {
        await this.silo.connect(user).deposit(this.siloToken.address, '100', EXTERNAL)
        this.result = await this.silo.connect(user).callStatic.transferDeposit(userAddress, user2Address, this.siloToken.address, '2', '50')
        expect(this.result).to.be.equal('50')
      })

      beforeEach(async function () {
        await this.silo.connect(user).deposit(this.siloToken.address, '100', EXTERNAL)
        this.result = await this.silo.connect(user).transferDeposit(userAddress, user2Address, this.siloToken.address, '2', '50')
      })

      it('removes the deposit from the sender', async function () {
        const deposit = await this.silo.getDeposit(userAddress, this.siloToken.address, '2')
        expect(deposit[0]).to.equal('50');
        expect(deposit[0]).to.equal('50');
      })

      it('updates users stalk and seeds', async function () {
        expect(await this.silo.balanceOfStalk(userAddress)).to.be.equal('500000')
        expect(await this.silo.balanceOfSeeds(userAddress)).to.be.equal('50')
      })

      it('add the deposit to the recipient', async function () {
        const deposit = await this.silo.getDeposit(user2Address, this.siloToken.address, '2')
        expect(deposit[0]).to.equal('50');
        expect(deposit[0]).to.equal('50');
      })

      it('updates users stalk and seeds', async function () {
        expect(await this.silo.balanceOfStalk(user2Address)).to.be.equal('500000')
        expect(await this.silo.balanceOfSeeds(user2Address)).to.be.equal('50')
      })

      it('updates total stalk and seeds', async function () {
        expect(await this.silo.totalStalk()).to.be.equal('1000000')
        expect(await this.silo.totalSeeds()).to.be.equal('100')
      })
    })

    describe("Single all", async function () {
      beforeEach(async function () {
        await this.silo.connect(user).deposit(this.siloToken.address, '100', EXTERNAL)
        await this.silo.connect(user).transferDeposit(userAddress, user2Address, this.siloToken.address, '2', '100')
      })

      it('removes the deposit from the sender', async function () {
        const deposit = await this.silo.getDeposit(userAddress, this.siloToken.address, '2')
        expect(deposit[0]).to.equal('0');
        expect(deposit[0]).to.equal('0');
      })

      it('updates users stalk and seeds', async function () {
        expect(await this.silo.balanceOfStalk(userAddress)).to.be.equal('0')
        expect(await this.silo.balanceOfSeeds(userAddress)).to.be.equal('0')
      })

      it('add the deposit to the recipient', async function () {
        const deposit = await this.silo.getDeposit(user2Address, this.siloToken.address, '2')
        expect(deposit[0]).to.equal('100');
        expect(deposit[0]).to.equal('100');
      })

      it('updates users stalk and seeds', async function () {
        expect(await this.silo.balanceOfStalk(user2Address)).to.be.equal('1000000')
        expect(await this.silo.balanceOfSeeds(user2Address)).to.be.equal('100')
      })

      it('updates total stalk and seeds', async function () {
        expect(await this.silo.totalStalk()).to.be.equal('1000000')
        expect(await this.silo.totalSeeds()).to.be.equal('100')
      })
    })

    describe("Multiple", async function () {
      it('returns the correct value', async function () {
        await this.silo.connect(user).deposit(this.siloToken.address, '100', EXTERNAL)
        await this.season.siloSunrise('0')
        await this.silo.connect(user).deposit(this.siloToken.address, '100', EXTERNAL)
        this.result = await this.silo.connect(user).callStatic.transferDeposits(userAddress, user2Address, this.siloToken.address, ['2', '3'], ['50','25'])
      })

      beforeEach(async function () {
        await this.silo.connect(user).deposit(this.siloToken.address, '100', EXTERNAL)
        await this.season.siloSunrise('0')
        await this.silo.connect(user).deposit(this.siloToken.address, '100', EXTERNAL)
        this.result = await this.silo.connect(user).transferDeposits(userAddress, user2Address, this.siloToken.address, ['2', '3'], ['50','25'])
      })

      it('removes the deposit from the sender', async function () {
        let deposit = await this.silo.getDeposit(userAddress, this.siloToken.address, '2')
        expect(deposit[0]).to.equal('50');
        expect(deposit[0]).to.equal('50');
        deposit = await this.silo.getDeposit(userAddress, this.siloToken.address, '3')
        expect(deposit[0]).to.equal('75');
        expect(deposit[0]).to.equal('75');
      })

      it('updates users stalk and seeds', async function () {
        expect(await this.silo.balanceOfStalk(userAddress)).to.be.equal('1250050')
        expect(await this.silo.balanceOfSeeds(userAddress)).to.be.equal('125')
      })

      it('add the deposit to the recipient', async function () {
        let deposit = await this.silo.getDeposit(user2Address, this.siloToken.address, '2')
        expect(deposit[0]).to.equal('50');
        expect(deposit[0]).to.equal('50');
        deposit = await this.silo.getDeposit(user2Address, this.siloToken.address, '3')
        expect(deposit[0]).to.equal('25');
        expect(deposit[0]).to.equal('25');
      })

      it('updates users stalk and seeds', async function () {
        expect(await this.silo.balanceOfStalk(user2Address)).to.be.equal('750050')
        expect(await this.silo.balanceOfSeeds(user2Address)).to.be.equal('75')
      })

      it('updates total stalk and seeds', async function () {
        expect(await this.silo.totalStalk()).to.be.equal('2000100')
        expect(await this.silo.totalSeeds()).to.be.equal('200')
      })
    })

    describe("Single with allowance", async function () {
      beforeEach(async function () {
        await this.silo.connect(user).deposit(this.siloToken.address, '100', EXTERNAL)
        await this.silo.connect(user).approveDeposit(ownerAddress, this.siloToken.address, '100');
        await this.silo.connect(owner).transferDeposit(userAddress, user2Address, this.siloToken.address, '2', '50')
      })

      it('removes the deposit from the sender', async function () {
        const deposit = await this.silo.getDeposit(userAddress, this.siloToken.address, '2')
        expect(deposit[0]).to.equal('50');
        expect(deposit[0]).to.equal('50');
      })

      it('updates users stalk and seeds', async function () {
        expect(await this.silo.balanceOfStalk(userAddress)).to.be.equal('500000')
        expect(await this.silo.balanceOfSeeds(userAddress)).to.be.equal('50')
      })

      it('add the deposit to the recipient', async function () {
        const deposit = await this.silo.getDeposit(user2Address, this.siloToken.address, '2')
        expect(deposit[0]).to.equal('50');
        expect(deposit[0]).to.equal('50');
      })

      it('updates users stalk and seeds', async function () {
        expect(await this.silo.balanceOfStalk(user2Address)).to.be.equal('500000')
        expect(await this.silo.balanceOfSeeds(user2Address)).to.be.equal('50')
      })

      it('updates total stalk and seeds', async function () {
        expect(await this.silo.totalStalk()).to.be.equal('1000000')
        expect(await this.silo.totalSeeds()).to.be.equal('100')
      })

      it('properly updates users token allowance', async function () {
        expect(await this.silo.depositAllowance(userAddress, ownerAddress, this.siloToken.address)).to.be.equal('50')
      })
    })

    describe("Single with no allowance", async function () {
      beforeEach(async function () {
        await this.silo.connect(user).deposit(this.siloToken.address, '100', EXTERNAL)
      })

      it('reverts with no allowance', async function () {
        await expect(this.silo.connect(owner).transferDeposit(userAddress, user2Address, this.siloToken.address, '2', '50')).to.revertedWith('Silo: insufficient allowance');
      })
    })

    describe("Single all with allowance", async function () {
      beforeEach(async function () {
        await this.silo.connect(user).deposit(this.siloToken.address, '100', EXTERNAL)
        await this.silo.connect(user).approveDeposit(ownerAddress, this.siloToken.address, '100');
        await this.silo.connect(owner).transferDeposit(userAddress, user2Address, this.siloToken.address, '2', '100');
      })

      it('removes the deposit from the sender', async function () {
        const deposit = await this.silo.getDeposit(userAddress, this.siloToken.address, '2')
        expect(deposit[0]).to.equal('0');
        expect(deposit[0]).to.equal('0');
      })

      it('updates users stalk and seeds', async function () {
        expect(await this.silo.balanceOfStalk(userAddress)).to.be.equal('0')
        expect(await this.silo.balanceOfSeeds(userAddress)).to.be.equal('0')
      })

      it('add the deposit to the recipient', async function () {
        const deposit = await this.silo.getDeposit(user2Address, this.siloToken.address, '2')
        expect(deposit[0]).to.equal('100');
        expect(deposit[0]).to.equal('100');
      })

      it('updates users stalk and seeds', async function () {
        expect(await this.silo.balanceOfStalk(user2Address)).to.be.equal('1000000')
        expect(await this.silo.balanceOfSeeds(user2Address)).to.be.equal('100')
      })

      it('updates total stalk and seeds', async function () {
        expect(await this.silo.totalStalk()).to.be.equal('1000000')
        expect(await this.silo.totalSeeds()).to.be.equal('100')
      })

      it('properly updates users token allowance', async function () {
        expect(await this.silo.depositAllowance(userAddress, ownerAddress, this.siloToken.address)).to.be.equal('0')
      })
    })

    describe("Multiple with allowance", async function () {
      beforeEach(async function () {
        await this.silo.connect(user).deposit(this.siloToken.address, '100', EXTERNAL)
        await this.season.siloSunrise('0')
        await this.silo.connect(user).deposit(this.siloToken.address, '100', EXTERNAL)
        await this.silo.connect(user).approveDeposit(ownerAddress, this.siloToken.address, '200');
        await this.silo.connect(owner).transferDeposits(userAddress, user2Address, this.siloToken.address, ['2', '3'], ['50','25'])
      })

      it('removes the deposit from the sender', async function () {
        let deposit = await this.silo.getDeposit(userAddress, this.siloToken.address, '2')
        expect(deposit[0]).to.equal('50');
        expect(deposit[0]).to.equal('50');
        deposit = await this.silo.getDeposit(userAddress, this.siloToken.address, '3')
        expect(deposit[0]).to.equal('75');
        expect(deposit[0]).to.equal('75');
      })

      it('updates users stalk and seeds', async function () {
        expect(await this.silo.balanceOfStalk(userAddress)).to.be.equal('1250050')
        expect(await this.silo.balanceOfSeeds(userAddress)).to.be.equal('125')
      })

      it('add the deposit to the recipient', async function () {
        let deposit = await this.silo.getDeposit(user2Address, this.siloToken.address, '2')
        expect(deposit[0]).to.equal('50');
        expect(deposit[0]).to.equal('50');
        deposit = await this.silo.getDeposit(user2Address, this.siloToken.address, '3')
        expect(deposit[0]).to.equal('25');
        expect(deposit[0]).to.equal('25');
      })

      it('updates users stalk and seeds', async function () {
        expect(await this.silo.balanceOfStalk(user2Address)).to.be.equal('750050')
        expect(await this.silo.balanceOfSeeds(user2Address)).to.be.equal('75')
      })

      it('updates total stalk and seeds', async function () {
        expect(await this.silo.totalStalk()).to.be.equal('2000100')
        expect(await this.silo.totalSeeds()).to.be.equal('200')
      })

      it('properly updates users token allowance', async function () {
        expect(await this.silo.depositAllowance(userAddress, ownerAddress, this.siloToken.address)).to.be.equal('125')
      })
    })

    describe("Multiple with no allowance", async function () {
      beforeEach(async function () {
        await this.silo.connect(user).deposit(this.siloToken.address, '100', EXTERNAL)
        await this.season.siloSunrise('0')
        await this.silo.connect(user).deposit(this.siloToken.address, '100', EXTERNAL)
      })

      it('reverts with no allowance', async function () {
        await expect(this.silo.connect(owner).transferDeposits(userAddress, user2Address, this.siloToken.address, ['2', '3'], ['50','25'])).to.revertedWith('Silo: insufficient allowance');
      })
    })
  })

  describe("Update Unripe Deposit", async function () {
    describe("1 deposit, some", async function () {
      beforeEach(async function () {
        await this.silo.connect(user).deposit(UNRIPE_BEAN, to6('5'), EXTERNAL)
        await this.silo.connect(user).mockUnripeBeanDeposit('2', to6('5'))
        await this.unripe.connect(owner).addUnderlying(
          UNRIPE_BEAN,
          to6('1000')
        )

        this.result = await this.silo.connect(user).enrootDeposit(UNRIPE_BEAN, '2', to6('5'));
      })

      it('properly updates the total balances', async function () {
        expect(await this.silo.getTotalDeposited(UNRIPE_BEAN)).to.eq(to6('10'));
        expect(await this.silo.totalStalk()).to.eq(pruneToStalk(to6('10')).add(toStalk('0.5')));
        expect(await this.silo.totalSeeds()).to.eq(pruneToSeeds(to6('10')).add(to6('1')));
      });

      it('properly updates the user balance', async function () {
        expect(await this.silo.balanceOfStalk(userAddress)).to.eq(pruneToStalk(to6('10')).add(toStalk('0.5')));
        expect(await this.silo.balanceOfSeeds(userAddress)).to.eq(pruneToSeeds(to6('10')).add(to6('1')));
      });

      it('properly removes the crate', async function () {
        let dep = await this.silo.getDeposit(userAddress, UNRIPE_BEAN, 2);
        expect(dep[0]).to.equal(to6('10'))
        expect(dep[1]).to.equal(prune(to6('10')).add(to6('0.5')))
      });

      it('emits Remove and Withdrawal event', async function () {
        await expect(this.result).to.emit(this.silo, 'RemoveDeposit').withArgs(userAddress, UNRIPE_BEAN, 2, to6('5'));
        await expect(this.result).to.emit(this.silo, 'AddDeposit').withArgs(userAddress, UNRIPE_BEAN, 2, to6('5'), prune(to6('5')).add(to6('0.5')));
      });
    });

    describe("1 deposit after 1 sesaon, all", async function () {
      beforeEach(async function () {
        await this.silo.connect(user).deposit(UNRIPE_BEAN, to6('5'), EXTERNAL)
        await this.silo.connect(user).mockUnripeBeanDeposit('2', to6('5'))
        
        await this.season.lightSunrise()

        await this.unripe.connect(owner).addUnderlying(
          UNRIPE_BEAN,
          to6('5000').sub(to6('10000').mul(toBN(pru)).div(to18('1')))
        )

        this.result = await this.silo.connect(user).enrootDeposit(UNRIPE_BEAN, '2', to6('10'));
      })

      it('properly updates the total balances', async function () {
        expect(await this.silo.getTotalDeposited(UNRIPE_BEAN)).to.eq(to6('10'));
        expect(await this.silo.totalStalk()).to.eq(toStalk('5.001'));
        expect(await this.silo.totalSeeds()).to.eq(to6('10'));
      });

      it('properly updates the user balance', async function () {
        expect(await this.silo.balanceOfStalk(userAddress)).to.eq(toStalk('5.001'));
        expect(await this.silo.balanceOfSeeds(userAddress)).to.eq(to6('10'));
      });

      it('properly removes the crate', async function () {
        let dep = await this.silo.getDeposit(userAddress, UNRIPE_BEAN, 2);
        expect(dep[0]).to.equal(to6('10'))
        expect(dep[1]).to.equal(to6('5'))
      });

      it('emits Remove and Withdrawal event', async function () {
        await expect(this.result).to.emit(this.silo, 'RemoveDeposit').withArgs(userAddress, UNRIPE_BEAN, 2, to6('10'));
        await expect(this.result).to.emit(this.silo, 'AddDeposit').withArgs(userAddress, UNRIPE_BEAN, 2, to6('10'), to6('5'));
      });
    });

    describe("2 deposit, all", async function () {
      beforeEach(async function () {
        await this.silo.connect(user).mockUnripeBeanDeposit('2', to6('5'))

        await this.season.lightSunrise()
        await this.silo.connect(user).deposit(UNRIPE_BEAN, to6('5'), EXTERNAL)
        
        
        await this.unripe.connect(owner).addUnderlying(
          UNRIPE_BEAN,
          to6('5000').sub(to6('10000').mul(toBN(pru)).div(to18('1')))
        )

        this.result = await this.silo.connect(user).enrootDeposits(UNRIPE_BEAN, ['2', '3'], [to6('5'), to6('5')]);
      })

      it('properly updates the total balances', async function () {
        expect(await this.silo.getTotalDeposited(UNRIPE_BEAN)).to.eq(to6('10'));
        expect(await this.silo.totalStalk()).to.eq(toStalk('5.0005'));
        expect(await this.silo.totalSeeds()).to.eq(to6('10'));
      });

      it('properly updates the user balance', async function () {
        expect(await this.silo.balanceOfStalk(userAddress)).to.eq(toStalk('5.0005'));
        expect(await this.silo.balanceOfSeeds(userAddress)).to.eq(to6('10'));
      });

      it('properly removes the crate', async function () {
        let dep = await this.silo.getDeposit(userAddress, UNRIPE_BEAN, 2);
        expect(dep[0]).to.equal(to6('5'))
        expect(dep[1]).to.equal(to6('2.5'))
      });

      it('emits Remove and Withdrawal event', async function () {
        await expect(this.result).to.emit(this.silo, 'RemoveDeposits').withArgs(userAddress, UNRIPE_BEAN, [2,3], [to6('5'), to6('5')], to6('10'));
        await expect(this.result).to.emit(this.silo, 'AddDeposit').withArgs(userAddress, UNRIPE_BEAN, 2, to6('5'), to6('2.5'));
        await expect(this.result).to.emit(this.silo, 'AddDeposit').withArgs(userAddress, UNRIPE_BEAN, 3, to6('5'), to6('2.5'));
      });
    });
  });

  describe("Deposit Approval", async function () {
    describe("approve allowance", async function () {
      beforeEach(async function () {
        this.result = await this.silo.connect(user).approveDeposit(user2Address, this.siloToken.address, '100');
      })

      it('properly updates users token allowance', async function () {
        expect(await this.silo.depositAllowance(userAddress, user2Address, this.siloToken.address)).to.be.equal('100')
      })

      it('emits DepositApproval event', async function () {
        await expect(this.result).to.emit(this.silo, 'DepositApproval').withArgs(userAddress ,user2Address, this.siloToken.address, '100');
      });
    })

    describe("increase and decrease allowance", async function () {
      beforeEach(async function () {
        await this.silo.connect(user).approveDeposit(user2Address, this.siloToken.address, '100');
      })

      it('properly increase users token allowance', async function () {
        await this.silo.connect(user).increaseDepositAllowance(user2Address, this.siloToken.address, '100');
        expect(await this.silo.depositAllowance(userAddress, user2Address, this.siloToken.address)).to.be.equal('200')
      })

      it('properly decrease users token allowance', async function () {
        await this.silo.connect(user).decreaseDepositAllowance(user2Address, this.siloToken.address, '25')
        expect(await this.silo.depositAllowance(userAddress, user2Address, this.siloToken.address)).to.be.equal('75')
      })

      it('decrease users token allowance below zero', async function () {
        await expect(this.silo.connect(user).decreaseDepositAllowance(user2Address, this.siloToken.address, '101')).to.revertedWith('Silo: decreased allowance below zero');
      })

      it('emits DepositApproval event on increase', async function () {
        const result = await this.silo.connect(user).increaseDepositAllowance(user2Address, this.siloToken.address, '25');
        await expect(result).to.emit(this.silo, 'DepositApproval').withArgs(userAddress ,user2Address, this.siloToken.address, '125');
      });

      it('emits DepositApproval event on decrease', async function () {
        const result = await this.silo.connect(user).decreaseDepositAllowance(user2Address, this.siloToken.address, '25');
        await expect(result).to.emit(this.silo, 'DepositApproval').withArgs(userAddress ,user2Address, this.siloToken.address, '75');
      });
    })
  });
});