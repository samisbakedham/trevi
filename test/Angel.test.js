const {
  balance,
  BN,
  constants,
  ether,
  expectEvent,
  expectRevert,
  time,
} = require('@openzeppelin/test-helpers');
const { advanceBlockTo, duration, increase, latest, latestBlock } = time;
const { seconds } = duration;
const { tracker } = balance;
const { ZERO_ADDRESS, MAX_UINT256 } = constants;
const utils = web3.utils;
const { getCreated } = require('./helpers/utils');

const { expect } = require('chai');

const Archangel = artifacts.require('Archangel');
const Angel = artifacts.require('Angel');
const AngelFactory = artifacts.require('AngelFactory');
const Fountain = artifacts.require('Fountain');
const FountainFactory = artifacts.require('FountainFactory');
const SimpleToken = artifacts.require('SimpleToken');
const ERC20 = artifacts.require('ERC20');
const RewarderMock = artifacts.require('RewarderMock');

contract('Angel', function([_, user, rewarder]) {
  beforeEach(async function() {
    this.archangel = await Archangel.new();
    const angelFactory = await this.archangel.angelFactory.call();
    const fountainFactory = await this.archangel.fountainFactory.call();
    this.angelFactory = await AngelFactory.at(angelFactory);
    this.fountainFactory = await FountainFactory.at(fountainFactory);
    this.stkToken = await SimpleToken.new('Staking', 'STK', ether('1000000'), {
      from: user,
    });
    this.rwdToken = await SimpleToken.new('Reward', 'RWD', ether('1000000'), {
      from: rewarder,
    });
    this.dummy = await SimpleToken.new('Reward', 'RWD', ether('1000000'), {
      from: rewarder,
    });
    // create fountain
    this.fountain = await getCreated(
      await this.fountainFactory.create(this.stkToken.address),
      Fountain
    );
    // create angel
    this.angel = await getCreated(
      await this.angelFactory.create(this.rwdToken.address, { from: rewarder }),
      Angel
    );
    await this.angel.setSushiPerSecond(ether('0.01'), { from: rewarder });
    await this.rwdToken.transfer(this.angel.address, ether('5000'), {
      from: rewarder,
    });
    this.rewarder = await RewarderMock.new(
      ether('1'),
      this.dummy.address,
      this.angel.address
    );
  });

  describe('PoolLength', function() {
    it('PoolLength should execute', async function() {
      await this.angel.add(10, this.stkToken.address, this.rewarder.address, {
        from: rewarder,
      });
      expect(await this.angel.poolLength()).to.be.bignumber.eq(new BN('1'));
    });
  });

  describe('Set', function() {
    it('Should emit event LogSetPool', async function() {
      await this.angel.add(
        new BN('10'),
        this.stkToken.address,
        this.rewarder.address,
        { from: rewarder }
      );
      const receipt1 = await this.angel.set(
        new BN('0'),
        new BN('10'),
        this.dummy.address,
        false,
        {
          from: rewarder,
        }
      );
      expectEvent(receipt1, 'LogSetPool', {
        pid: new BN('0'),
        allocPoint: new BN('10'),
        rewarder: this.rewarder.address,
        overwrite: false,
      });
      const receipt2 = await this.angel.set(
        new BN('0'),
        new BN('10'),
        this.dummy.address,
        true,
        {
          from: rewarder,
        }
      );
      expectEvent(receipt2, 'LogSetPool', {
        pid: new BN('0'),
        allocPoint: new BN('10'),
        rewarder: this.dummy.address,
        overwrite: true,
      });
    });

    it('Should revert if invalid pool', async function() {
      await expectRevert(
        this.angel.set(
          new BN('0'),
          new BN('10'),
          this.rewarder.address,
          false,
          {
            from: rewarder,
          }
        ),
        'invalid opcode'
      );
    });
  });

  describe('PendingSushi', function() {
    it('PendingSushi should equal ExpectedSushi', async function() {
      await this.angel.add(
        new BN('10'),
        this.stkToken.address,
        this.rewarder.address,
        { from: rewarder }
      );
      await this.stkToken.approve(this.fountain.address, ether('10'), {
        from: user,
      });
      await this.fountain.joinAngel(this.angel.address, { from: user });
      const timestamp = await latest();
      await this.fountain.deposit(ether('1'), { from: user });
      await increase(seconds(86400));
      const timestamp2 = await latest();
      await this.angel.updatePool(new BN('0'));
      let expectedSushi = new BN('10000000000000000').mul(
        timestamp2.sub(timestamp)
      );
      let pendingSushi = await this.angel.pendingSushi.call(new BN('0'), user);
      expect(pendingSushi).to.be.bignumber.lte(expectedSushi);
    });

    it('When time is lastRewardTime', async function() {
      await this.angel.add(10, this.stkToken.address, this.rewarder.address, {
        from: rewarder,
      });
      await this.stkToken.approve(this.fountain.address, ether('10'), {
        from: user,
      });
      await this.fountain.joinAngel(this.angel.address, { from: user });
      const timestamp = await latest();
      await this.fountain.deposit(ether('1'), { from: user });
      await advanceBlockTo((await latestBlock()).add(new BN('3')));
      const timestamp2 = await latest();
      await this.angel.updatePool(new BN('0'));
      let expectedSushi = new BN('10000000000000000').mul(
        timestamp2.sub(timestamp)
      );
      let pendingSushi = await this.angel.pendingSushi.call(new BN('0'), user);
      expect(pendingSushi).to.be.bignumber.gte(expectedSushi);
    });
  });

  describe('MassUpdatePools', function() {
    it('Should call updatePool', async function() {
      await this.angel.add(10, this.stkToken.address, this.rewarder.address, {
        from: rewarder,
      });
      await advanceBlockTo((await latestBlock()).add(new BN('1')));
      await this.angel.massUpdatePools([0]);
      //expect('updatePool').to.be.calledOnContract(); //not suported by heardhat
      //expect('updatePool').to.be.calledOnContractWith(0); //not suported by heardhat
    });

    it('Updating invalid pools should fail', async function() {
      await expectRevert(
        this.angel.massUpdatePools([0, 10000, 100000]),
        'invalid opcode'
      );
    });
  });

  describe('Add', function() {
    it('Should add pool with reward token multiplier', async function() {
      expectEvent(
        await this.angel.add(
          new BN('10'),
          this.stkToken.address,
          this.rewarder.address,
          {
            from: rewarder,
          }
        ),
        'LogPoolAddition',
        {
          pid: new BN('0'),
          allocPoint: new BN('10'),
          lpToken: this.stkToken.address,
          rewarder: this.rewarder.address,
        }
      );
    });
  });

  describe('UpdatePool', function() {
    it('Should emit event LogUpdatePool', async function() {
      await this.angel.add(
        new BN('10'),
        this.stkToken.address,
        this.rewarder.address,
        {
          from: rewarder,
        }
      );
      await increase(seconds(86400));
      const receipt = await this.angel.updatePool(new BN('0'));
      expectEvent(receipt, 'LogUpdatePool', {
        pid: new BN('0'),
        lastRewardTime: (await this.angel.poolInfo.call(new BN('0')))
          .lastRewardTime,
        lpSupply: await this.stkToken.balanceOf.call(this.angel.address),
        accSushiPerShare: (await this.angel.poolInfo.call(new BN('0')))
          .accSushiPerShare,
      });
    });
  });

  describe('Fridge only functions', function() {
    beforeEach(async function() {
      await this.angel.add(
        new BN('10'),
        this.stkToken.address,
        this.rewarder.address,
        {
          from: rewarder,
        }
      );
    });

    it('Deposit', async function() {
      await expectRevert(
        this.angel.deposit(new BN('0'), ether('1'), user),
        'not called by correct fountain'
      );
    });

    it('Withdraw', async function() {
      await expectRevert(
        this.angel.withdraw(new BN('0'), ether('1'), user),
        'not called by correct fountain'
      );
    });

    it('Harvest', async function() {
      await expectRevert(
        this.angel.harvest(new BN('0'), user, user),
        'not called by correct fountain'
      );
    });

    it('Withdraw and harvest', async function() {
      await expectRevert(
        this.angel.withdrawAndHarvest(new BN('0'), ether('1'), user),
        'not called by correct fountain'
      );
    });

    it('Emergency Withdraw', async function() {
      await expectRevert(
        this.angel.emergencyWithdraw(new BN('0'), user),
        'not called by correct fountain'
      );
    });
  });
});
