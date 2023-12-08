import { Injectable, Logger } from '@nestjs/common';

import { BlockService } from 'src/modules/queue/services/block.service';

import { Web3Service } from './web3.service';
import { SupabaseService } from './supabase.service';
import { UtilityService } from '../utils/utility.service';

import { esip1Abi, esip2Abi } from 'src/abi/EthscriptionsProtocol';

import { etherPhunksMarketAbi } from 'src/abi/EtherPhunksMarket';
import etherPhunksAuctionHouseAbi from 'src/abi/EtherPhunksAuctionHouse.json';

import * as esips from 'src/constants/EthscriptionsProtocol';

import { Phunk } from 'src/models/db';

import { DecodeEventLogReturnType, FormattedTransaction, Log, Transaction, TransactionReceipt, decodeEventLog, hexToString } from 'viem';

import crypto from 'crypto';
import dotenv from 'dotenv';
import { TimeService } from 'src/utils/time.service';
dotenv.config();

const SEGMENT_SIZE = 64;

@Injectable()
export class ProcessingService {

  startTime: Date;

  constructor(
    private readonly blockSvc: BlockService,
    private readonly web3Svc: Web3Service,
    private readonly sbSvc: SupabaseService,
    private readonly utilSvc: UtilityService,
    private readonly timeSvc: TimeService,
  ) {}

  // Method to start fetching and processing blocks from the network
  async startBackfill(startBlock: number): Promise<void> {
    let blockNum: number = await this.blockSvc.getOrCreateBlockFile(startBlock);

    const latestBlock = await this.web3Svc.getBlock();
    const latestBlockNum = Number(latestBlock.number);

    while (blockNum < latestBlockNum) {
      await this.addBlockToQueue(blockNum, new Date().getTime());
      blockNum++;
    }
  }

  async startPolling(): Promise<void> {
    // Watch for new blocks and add them to the queue
    this.web3Svc.client.watchBlocks({
      onBlock: async (block) => {
        const blockNum = Number(block.number);
        const timestamp = new Date(Number(block.timestamp) * 1000).getTime();
        await this.addBlockToQueue(blockNum, timestamp);
      },
      onError: (error) => {
        console.log(error);

      }
    });
  }

  async processBlock(blockNum: number): Promise<void> {
    const { txns, createdAt } = await this.web3Svc.getBlockTransactions(blockNum);
    const timeAgo = this.timeSvc.howLongAgo(createdAt as any);
    Logger.log(`Processing block ${blockNum} (${this.web3Svc.chain}) ➖ ${timeAgo}`);
    await this.processTransactions(txns, createdAt);
  }

  async retryBlock(blockNum: number): Promise<void> {
    try {
      Logger.debug(`Retrying block ${blockNum} (${this.web3Svc.chain})`);
      await this.utilSvc.delay(5000);
      // Get the transactions from the block
      const { txns, createdAt } = await this.web3Svc.getBlockTransactions(blockNum);
      await this.processTransactions(txns, createdAt);
    } catch (error) {
      console.log(error);
      // Pause for 10 seconds
      await this.utilSvc.delay(5000);
      // Retry the block
      return this.retryBlock(blockNum);
    }
  }

  async addBlockToQueue(blockNum: number, blockTimestamp: number): Promise<void> {
    await this.blockSvc.addBlockToQueue(blockNum, blockTimestamp);
  }

  // Method to add transactions to the database
  async processTransactions(
    txns: { transaction: FormattedTransaction; receipt: TransactionReceipt; }[],
    createdAt: Date
  ) {

    // Sort by transaction index
    txns = txns.sort((a, b) => a.receipt.transactionIndex - a.receipt.transactionIndex);

    for (let i = 0; i < txns.length; i++) {
      const transaction = txns[i].transaction as Transaction;
      const receipt = txns[i].receipt as TransactionReceipt;

      const { input } = transaction;

      // Skip any transaction with no input
      // Skip any transaction that failed
      if (input === '0x' || receipt.status !== 'success') continue;

      // DISABLED: All 10,000 have been ethscribed
      // Check if possible ethPhunk
      const { possibleEthPhunk, cleanedString } = this.possibleEthPhunk(input);
      if (possibleEthPhunk) {
        Logger.debug('Processing ethscription', transaction.hash);
        await this.processEthscriptionEvent(transaction as Transaction, createdAt, cleanedString);
        continue;
      }

      // Check if possible transfer
      const possibleTransfer = input.substring(2).length === SEGMENT_SIZE;
      if (possibleTransfer) {
        Logger.debug(`Processing transfer (${this.web3Svc.chain})`, transaction.hash);
        await this.processTransferEvent(
          input,
          transaction as Transaction,
          createdAt
        );
      }

      // Check if possible batch transfer
      const possibleBatchTransfer =
        input.substring(2).length !== SEGMENT_SIZE
        && input.substring(2).length % SEGMENT_SIZE === 0;

      if (possibleBatchTransfer) {
        await this.processEsip5(
          transaction as Transaction,
          createdAt
        );
      }

      // Filter logs for ethscription transfers (esip1)
      const esip1Transfers = receipt.logs.filter(
        (log: any) => log.topics[0] === esips.TransferEthscriptionSignature
      );
      if (esip1Transfers.length) {
        Logger.debug(
          `Processing marketplace event (esip1) (${this.web3Svc.chain})`,
          transaction.hash
        );
        await this.processEsip1(esip1Transfers, transaction, createdAt);
        continue;
      }

      // Filter logs for ethscription transfers (esip2)
      const esip2Transfers = receipt.logs.filter(
        (log: any) => log.topics[0] === esips.TransferEthscriptionForPreviousOwnerSignature
      );
      if (esip2Transfers.length) {
        Logger.debug(
          `Processing marketplace event (esip2) (${this.web3Svc.chain})`,
          transaction.hash
        );
        await this.processEsip2(esip2Transfers, transaction, createdAt);
      }

      // Filter logs for EtherPhunk Marketplace events
      const marketplaceLogs = receipt.logs.filter(
        (log: any) => log.address === this.web3Svc.marketAddress
      );
      if (marketplaceLogs.length) {
        Logger.debug(
          `Processing EtherPhunk Marketplace event (${this.web3Svc.chain})`,
          transaction.hash
        );
        await this.processEtherPhunkMarketplaceEvents(marketplaceLogs, transaction, createdAt);
      }

      // Filter logs for EtherPhunk Auction House Events
      const auctionHouseLogs = receipt.logs.filter(
        (log: any) => log.address === this.web3Svc.auctionAddress
      );
      if (auctionHouseLogs.length) {
        Logger.debug(
          `Processing EtherPhunk Auction House event (${this.web3Svc.chain})`,
          transaction.hash
        );
        await this.processAuctionHouseEvents(auctionHouseLogs, transaction, createdAt);
      }
    }
  }

  async processEthscriptionEvent(txn: Transaction, createdAt: Date, cleanedString: string): Promise<void> {
    const content = cleanedString.split('data:image/svg+xml,')[1];
    if (!content) return;

    const { from, to, hash } = txn;
    // Check if the sha already exists in the shas table
    const sha = crypto.createHash('sha256').update(cleanedString).digest('hex');
    const phunkId = await this.sbSvc.checkIsEthPhunks(sha);
    if (!phunkId && phunkId !== 0) return;

    // Check if the sha already exists in the ethPhunks table
    const isDuplicate = await this.sbSvc.checkEthPhunkExistsBySha(sha);
    if (isDuplicate) return;

    // Get or create the users from address
    const [ toUser, fromUser ] = await Promise.all([
      from.toLowerCase() === to.toLowerCase() ? null : this.sbSvc.getOrCreateUser(from, createdAt),
      this.sbSvc.getOrCreateUser(to, createdAt)
    ]);

    // Add the ethereum phunk
    await this.sbSvc.addEthPhunk(txn, createdAt, phunkId, sha);
    // Add the creation event
    await this.sbSvc.addEvent(txn, from, to, hash, phunkId, 'created', createdAt, BigInt(0), 0);
    Logger.log('Added eth phunk', `${phunkId} -- ${hash.toLowerCase()}`);
  }

  async processTransferEvent(
    hashId: string,
    txn: Transaction,
    createdAt: Date,
  ): Promise<void> {
    const ethPhunk: Phunk = await this.sbSvc.checkEthPhunkExistsByHashId(hashId);
    if (!ethPhunk) return;

    const { from, to } = txn;
    const isMatchedHashId = ethPhunk.hashId.toLowerCase() === hashId.toLowerCase();
    const transferrerIsOwner = ethPhunk.owner.toLowerCase() === txn.from.toLowerCase();

    if (!isMatchedHashId || !transferrerIsOwner) return;

    // Get or create the users from address
    await this.sbSvc.getOrCreateUser(to, createdAt);

    // Update the eth phunk owner
    await this.sbSvc.updateEthPhunkOwner(hashId, ethPhunk.owner, txn.to);

    // Add the transfer event
    await this.sbSvc.addEvent(txn, from, to, hashId, ethPhunk.phunkId, 'transfer', createdAt, txn.value, Date.now());
    Logger.log('Updated eth phunk owner', `Hash: ${hashId} -- To: ${txn.to.toLowerCase()}`);
  }

  async processContractTransferEvent(
    txn: Transaction,
    createdAt: Date,
    from: string,
    to: string,
    hashId: string,
    value?: bigint,
    prevOwner?: string,
    log?: Log,
  ): Promise<void> {
    const ethPhunk: Phunk = await this.sbSvc.checkEthPhunkExistsByHashId(hashId);
    if (!ethPhunk) return;

    const isMatchedHashId = ethPhunk.hashId.toLowerCase() === hashId.toLowerCase();
    const transferrerIsOwner = ethPhunk.owner.toLowerCase() === from.toLowerCase();

    const samePrevOwner = (ethPhunk.prevOwner && prevOwner) ? ethPhunk.prevOwner.toLowerCase() === prevOwner.toLowerCase() : true;

    // console.log({isMatchedHashId, transferrerIsOwner, samePrevOwner});

    if (!isMatchedHashId || !transferrerIsOwner || !samePrevOwner) return;

    // Get or create the users from address
    await this.sbSvc.getOrCreateUser(to, createdAt);

    // Update the eth phunk owner
    await this.sbSvc.updateEthPhunkOwner(ethPhunk.hashId, ethPhunk.owner, to);

    // Add the sale/transfer event
    await this.sbSvc.addEvent(
      txn,
      from,
      to,
      ethPhunk.hashId,
      ethPhunk.phunkId,
      'transfer',
      createdAt,
      value,
      log.logIndex
    );
    Logger.log('Updated eth phunk owner (contract event)', `Hash: ${ethPhunk.hashId} -- To: ${to.toLowerCase()}`);
  }

  async processEsip1(
    ethscriptionTransfers: any[],
    transaction: Transaction,
    createdAt: Date
  ): Promise<void> {
    for (const log of ethscriptionTransfers) {
      const decoded = decodeEventLog({
        abi: esip1Abi,
        data: log.data,
        topics: log.topics,
      });

      const sender = log.address;
      const recipient = decoded.args['recipient'];
      const hashId = decoded.args['id'] || decoded.args['ethscriptionId'];

      await this.processContractTransferEvent(
        transaction,
        createdAt,
        sender,
        recipient,
        hashId,
        transaction.value,
        null,
        log
      );
    }
  }

  async processEsip2(
    previousOwnerTransfers: any[],
    transaction: Transaction,
    createdAt: Date
  ): Promise<void> {
    for (const log of previousOwnerTransfers) {
      const decoded = decodeEventLog({
        abi: esip2Abi,
        data: log.data,
        topics: log.topics,
      });

      const sender = log.address;
      const prevOwner = decoded.args['previousOwner'];
      const recipient = decoded.args['recipient'];
      const hashId = decoded.args['id'] || decoded.args['ethscriptionId'];

      await this.processContractTransferEvent(
        transaction,
        createdAt,
        sender,
        recipient,
        hashId,
        transaction.value,
        prevOwner,
        log
      );
    }
  }

  async processEsip5(txn: Transaction, createdAt: Date) {
    const { input } = txn;
    const data = input.substring(2);
    if (data.length % SEGMENT_SIZE !== 0) return;

    const first64 = '0x' + data.substring(0, SEGMENT_SIZE);
    const exists: Phunk = await this.sbSvc.checkEthPhunkExistsByHashId(first64);
    if (!exists) return;

    Logger.debug(`Processing batch transfer (${this.web3Svc.chain})`, txn.hash);
    for (let i = 0; i < data.length; i += SEGMENT_SIZE) {
      try {
        const hashId = '0x' + data.substring(i, i + SEGMENT_SIZE).toLowerCase();
        await this.processTransferEvent(hashId, txn, createdAt);
      } catch (error) {
        console.log(error);
      }
    }
  }

  async processEtherPhunkMarketplaceEvents(
    marketplaceLogs: any[],
    transaction: Transaction,
    createdAt: Date
  ): Promise<void> {
    for (const log of marketplaceLogs) {

      if (log.address.toLowerCase() !== this.web3Svc.marketAddress) continue;

      const decoded = decodeEventLog({
        abi: etherPhunksMarketAbi,
        data: log.data,
        topics: log.topics,
      });

      await this.processEtherPhunkMarketplaceEvent(transaction, createdAt, decoded, log);
    }
  }

  async processEtherPhunkMarketplaceEvent(
    txn: Transaction,
    createdAt: Date,
    decoded: DecodeEventLogReturnType,
    log: Log
  ): Promise<void> {
    const { eventName } = decoded;
    const { args } = decoded as any;

    if (!eventName || !args) return;

    const hashId =
      args.id ||
      args.phunkId ||
      args.potentialEthscriptionId;

    if (!hashId) return;

    const phunkExists = await this.sbSvc.checkEthPhunkExistsByHashId(hashId);
    if (!phunkExists) return;

    // Get or create the users from address
    await this.sbSvc.getOrCreateUser(txn.from, createdAt);

    if (eventName === 'PhunkBought') {
      const { phunkId: hashId, fromAddress, toAddress, value } = args;

      const bid = await this.sbSvc.getBid(hashId);
      if (bid && bid.fromAddress?.toLowerCase() === toAddress.toLowerCase()) {
        await this.sbSvc.removeBid(hashId);
      }

      await this.sbSvc.removeListing(hashId);
      await this.sbSvc.addEvent(
        txn,
        fromAddress,
        toAddress,
        hashId,
        phunkExists.phunkId,
        eventName,
        createdAt,
        value,
        log.logIndex
      );

      this.distributePoints(fromAddress);
    }

    if (eventName === 'PhunkBidEntered') {
      const { phunkId: hashId, fromAddress, value } = args;
      await this.sbSvc.createBid(txn, createdAt, hashId, fromAddress, value);
      await this.sbSvc.addEvent(
        txn,
        txn.from,
        null,
        hashId,
        phunkExists.phunkId,
        eventName,
        createdAt,
        value,
        log.logIndex
      );
    }

    if (eventName === 'PhunkBidWithdrawn') {
      const { phunkId: hashId } = args;
      await this.sbSvc.removeBid(hashId);
      await this.sbSvc.addEvent(
        txn,
        txn.from,
        null,
        hashId,
        phunkExists.phunkId,
        eventName,
        createdAt,
        BigInt(0),
        log.logIndex
      );
    }

    if (eventName === 'PhunkNoLongerForSale') {
      const { phunkId: hashId } = args;
      // console.log(args);
      await this.sbSvc.removeListing(hashId);
      await this.sbSvc.addEvent(
        txn,
        txn.from,
        null,
        hashId,
        phunkExists.phunkId,
        eventName,
        createdAt,
        BigInt(0),
        log.logIndex
      );
    }

    if (eventName === 'PhunkOffered') {
      const { phunkId: hashId, toAddress, minValue } = args;
      await this.sbSvc.createListing(txn, createdAt, hashId, toAddress, minValue);
      await this.sbSvc.addEvent(
        txn,
        txn.from,
        toAddress,
        hashId,
        phunkExists.phunkId,
        eventName,
        createdAt,
        minValue,
        log.logIndex
      );
    }
  }

  async processAuctionHouseEvents(
    auctionHouseLogs: any[],
    transaction: Transaction,
    createdAt: Date
  ): Promise<void> {
    for (const log of auctionHouseLogs) {

      if (log.address.toLowerCase() !== this.web3Svc.auctionAddress) continue;

      const decoded = decodeEventLog({
        abi: etherPhunksAuctionHouseAbi,
        data: log.data,
        topics: log.topics,
      });

      await this.processAuctionHouseEvent(transaction, createdAt, decoded, log);
    }
  }

  async processAuctionHouseEvent(
    txn: Transaction,
    createdAt: Date,
    decoded: DecodeEventLogReturnType,
    log: Log
  ): Promise<void> {
    const { eventName } = decoded;
    const { args } = decoded as any;

    if (!eventName || !args) return;

    const phunkId = args.hashId;
    if (!phunkId) return;

    const phunkExists = await this.sbSvc.checkEthPhunkExistsByHashId(phunkId);
    if (!phunkExists) return;

    if (eventName === 'AuctionSettled') {
      await this.sbSvc.settleAuction(args);
    }

    if (eventName === 'AuctionCreated') {
      await this.sbSvc.createAuction(args, createdAt);
    }

    if (eventName === 'AuctionBid') {
      await this.sbSvc.createAuctionBid(args, txn, createdAt);
    }

    if (eventName === 'AuctionExtended') {
      await this.sbSvc.extendAuction(args);
    }

    // event AuctionCreated(bytes32 indexed hashId, address owner, uint256 auctionId, uint256 startTime, uint256 endTime);
    // event AuctionBid(bytes32 indexed hashId, uint256 auctionId, address sender, uint256 value, bool extended);
    // event AuctionExtended(bytes32 indexed hashId, uint256 auctionId, uint256 endTime);
    // event AuctionSettled(bytes32 indexed hashId, uint256 auctionId, address winner, uint256 amount);
    // event AuctionTimeBufferUpdated(uint256 timeBuffer);
    // event AuctionDurationUpdated(uint256 duration);
    // event AuctionReservePriceUpdated(uint256 reservePrice);
    // event AuctionMinBidIncrementPercentageUpdated(uint256 minBidIncrementPercentage);
  }

  possibleEthPhunk(input: string): {
    possibleEthPhunk: boolean;
    cleanedString: string;
  } {
    // Get the data from the transaction
    const stringData = hexToString(input.toString() as `0x${string}`);
    // Remove null bytes from the string
    const cleanedString = stringData.replace(/\x00/g, '');
    // Check if the string starts with 'data:' and etherphunks svg
    const possibleEthPhunk = cleanedString.startsWith('data:image/svg+xml,');
    return { possibleEthPhunk, cleanedString };
  }

  async distributePoints(fromAddress: `0x${string}`): Promise<void> {
    try {
      const points = await this.web3Svc.getPoints(fromAddress);
      await this.sbSvc.updateUserPoints(fromAddress, Number(points));
      Logger.log(`Updated user points to ${points}`, fromAddress);
    } catch (error) {
      console.log(error);
    }
  }
}
