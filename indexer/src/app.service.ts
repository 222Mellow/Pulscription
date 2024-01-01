import { Injectable, Logger } from '@nestjs/common';

import { BlockService } from './modules/queue/services/block.service';

import { SupabaseService } from './services/supabase.service';
import { ProcessingService } from './services/processing.service';
import { Web3Service } from './services/web3.service';

import { UtilityService } from './utils/utility.service';

import { StandardMerkleTree } from '@openzeppelin/merkle-tree';

import * as MerkleTree from './abi/tree.json'

import dotenv from 'dotenv';
dotenv.config();

const chain: 'mainnet' | 'goerli' = process.env.CHAIN_ID === '1' ? 'mainnet' : 'goerli';
const originBlock = Number(chain === 'mainnet' ? process.env.ORIGIN_BLOCK_MAINNET : process.env.ORIGIN_BLOCK_GOERLI);

@Injectable()
export class AppService {

  constructor(
    private readonly blockSvc: BlockService,
    private readonly processSvc: ProcessingService,
    private readonly sbSvc: SupabaseService,
    private readonly utilSvc: UtilityService,
    private readonly web3Svc: Web3Service
  ) {
    this.blockSvc.clearQueue().then(() => {
      Logger.debug('Queue Cleared', chain.toUpperCase());
      this.startIndexer();
    });

    console.log(this.web3Svc.marketAddress);

    // this.reIndexBlock(18900944);
  }

  async reIndexBlock(blockNumber: number) {
    await this.processSvc.addBlockToQueue(blockNumber, new Date().getTime());
  }

  // Start Indexer //
  async startIndexer() {

    try {
      await this.utilSvc.delay(10000);
      await this.blockSvc.pauseQueue();

      const startBlock = await this.sbSvc.getLastBlock(Number(process.env.CHAIN_ID)) || originBlock;

      Logger.debug('Starting Backfill', chain.toUpperCase());
      await this.processSvc.startBackfill(startBlock);
      await this.blockSvc.resumeQueue();

      Logger.debug('Starting Block Watcher', chain.toUpperCase());
      await this.processSvc.startPolling();

    } catch (error) {
      Logger.error(error);
      this.startIndexer();
    }
  }

  getMerkleProofs(leaf: string): any {
    // return '';
    const tree = StandardMerkleTree.load(MerkleTree as any);
    const root = tree.root;
    let proof = tree.getProof([leaf]);

    console.log(root);
    return leaf + proof.map(p => p.substring(2)).join('');
  }

  getMerkleRoot(): string {
    // return '';
    const tree = StandardMerkleTree.load(MerkleTree as any);
    return tree.root
  }
}
