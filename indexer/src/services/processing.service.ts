import { Inject, Injectable, Logger } from '@nestjs/common';

import { Web3Service } from '@/modules/shared/services/web3.service';
import { SupabaseService } from '@/services/supabase.service';

import { UtilityService } from '@/modules/shared/services/utility.service';
import { TimeService } from '@/modules/shared/services/time.service';
import { EthscriptionsService } from '@/modules/ethscriptions/ethscriptions.service';
import { NftService } from '@/modules/nft/nft.service';

import { chain } from '@/constants/ethereum';

import { Event } from '@/models/db';

import { FormattedTransaction, GetBlockReturnType, Transaction, TransactionReceipt } from 'viem';

import dotenv from 'dotenv';
dotenv.config();

const CONFIRMATIONS = 6;
const BLOCK_HISTORY = 30;

interface ProcessedBlock {
  number: number,
  hash: `0x${string}`,
  parentHash: `0x${string}`,
  confirmed: boolean,
};

@Injectable()
export class ProcessingService {

  processedBlocks: Array<ProcessedBlock> = [];

  constructor(
    @Inject('WEB3_SERVICE_L1') private readonly web3SvcL1: Web3Service,
    private readonly sbSvc: SupabaseService,
    private readonly utilSvc: UtilityService,
    private readonly timeSvc: TimeService,
    private readonly ethsSvc: EthscriptionsService
  ) {}

  /**
   * Processes a block by retrieving its transactions, processing them, and adding the events to the database.
   * Optionally, updates the last block in the database.
   *
   * @param blockNum - The number of the block to process.
   * @param updateBlockDb - Whether to update the last block in the database. Default is true.
   * @returns A Promise that resolves when the block processing is complete.
   */
  async processBlock(n: number, updateBlockDb = true): Promise<void> {

    const block = await this.web3SvcL1.getBlock({ blockNumber: n, includeTransactions: true });
    const { number, hash, parentHash, timestamp, transactions } = block;

    if (n !== Number(number)) throw new Error(`Block number mismatch: ${n} !== ${number}`);

    const blockNumber = Number(number);
    const createdAt = new Date(Number(timestamp) * 1000);

    // Check for reorgs
    // await this.checkForReorg(block);

    // Log the block
    const timeAgo = this.timeSvc.howLongAgo(createdAt as any);
    Logger.log(
      `Processing block ${blockNumber} (L1)`,
      `${timeAgo.trim()}`
    );

    // Process the transactions & get the events
    const events = await this.processTransactions(transactions, createdAt);

    // Add the events to the database
    if (events.length) await this.sbSvc.addEvents(events);
    // Update the block in db
    if (updateBlockDb) this.sbSvc.updateLastBlock(blockNumber, createdAt);

    // Add the block to the processed blocks
    this.processedBlocks.push({ number: blockNumber, hash, parentHash, confirmed: false });
    if (this.processedBlocks.length > BLOCK_HISTORY) this.processedBlocks.shift();
  }

  /**
   * Retries processing a block if an error occurs.
   * @param blockNumber - The block number to retry.
   * @returns A Promise that resolves when the block processing is complete.
   */
  async retryBlock(blockNumber: number): Promise<void> {
    try {
      Logger.debug(`Retrying block ${blockNumber} (${chain})`);

      // Pause for 5 seconds
      await this.utilSvc.delay(5000);

      // Get the transactions from the block
      const { timestamp, transactions } = await this.web3SvcL1.getBlock({ blockNumber, includeTransactions: true });
      const createdAt = new Date(Number(timestamp) * 1000);

      await this.processTransactions(transactions, createdAt);
    } catch (error) {
      console.log(error);
      // Pause for 5 seconds
      await this.utilSvc.delay(5000);
      // Retry the block
      return this.retryBlock(blockNumber);
    }
  }

  /**
   * Processes an array of transactions and their receipts.
   * Sorts the transactions by transaction index and processes each transaction.
   * If an error occurs during processing, it logs the error, sends a message, and retries the block.
   * @param txns - An array of transactions and their receipts.
   * @param createdAt - The date when the transactions were created.
   * @returns An array of events generated from the processed transactions.
   */
  async processTransactions(
    txns: { transaction: FormattedTransaction; receipt: TransactionReceipt; }[],
    createdAt: Date
  ): Promise<Event[]> {

    txns = txns.filter((txn) => txn.transaction.input !== '0x');

    // Sort by transaction index
    txns = txns.sort((a, b) => a.receipt.transactionIndex - b.receipt.transactionIndex);

    let events: Event[] = [];

    for (let i = 0; i < txns.length; i++) {
      const transaction = txns[i].transaction as Transaction;
      const receipt = txns[i].receipt as TransactionReceipt;

      try {
        const transactionEvents = await this.processTransaction(transaction, receipt, createdAt);
        if (transactionEvents?.length) events.push(...transactionEvents);
      } catch (error) {
        console.log(error);
        await this.retryBlock(Number(transaction.blockNumber));
      }
    }
    return events;
  }

  /**
   * Processes a transaction and returns an array of events.
   *
   * @param transaction - The transaction object to process.
   * @param receipt - The transaction receipt object.
   * @param createdAt - The date when the transaction was created.
   * @returns A promise that resolves to an array of events.
   */
  async processTransaction(
    transaction: Transaction,
    receipt: TransactionReceipt,
    createdAt: Date
  ): Promise<Event[]> {

    // console.log({ transaction, receipt });

    // Skip any transaction that failed
    if (receipt.status !== 'success') return;

    const events: Event[] = [];

    const ethscriptionsEvents = await this.ethsSvc.processEthscriptionsEvents(
      transaction,
      receipt,
      createdAt
    );
    if (ethscriptionsEvents?.length) events.push(...ethscriptionsEvents);

    // const nftEvents = await this.nftSvc.processNftEvents(
    //   transaction,
    //   receipt,
    //   createdAt
    // );
    // if (nftEvents?.length) events.push(...nftEvents);

    return events;
  }

  /**
   * Checks for reorganization in the blockchain by comparing the parent hash of the given block
   * with the hash of the last processed block. If a reorg is detected, an error is thrown.
   * Also marks the block at CONFIRMATIONS distance from the last processed block as confirmed.
   * @param block - The block to check for reorg.
   * @throws Error if a reorg is detected at the given block.
   */
  async checkForReorg(block: GetBlockReturnType<any, any>) {
    const { number, parentHash } = block;

    const blockNumber = Number(number);
    if (this.processedBlocks.length > 0) {
      const lastProcessedBlock = this.processedBlocks[this.processedBlocks.length - 1];

      if (lastProcessedBlock.hash !== parentHash) {
        throw new Error(`Reorg detected at block ${blockNumber}`);
      }

      if (this.processedBlocks[this.processedBlocks.length - CONFIRMATIONS]) {
        this.processedBlocks[this.processedBlocks.length - CONFIRMATIONS].confirmed = true;
      }
    }
  }
}
