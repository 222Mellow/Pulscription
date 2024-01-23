import { Component, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormArray, FormBuilder, FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';

import { Store } from '@ngrx/store';
import { NgxPaginationModule } from 'ngx-pagination';
import { LazyLoadImageModule } from 'ng-lazyload-image';
import { NgSelectModule } from '@ng-select/ng-select';

import { PhunkGridComponent } from '@/components/shared/phunk-grid/phunk-grid.component';
import { MarketFiltersComponent } from '@/components/market-filters/market-filters.component';
import { ModalComponent } from '@/components/shared/modal/modal.component';

import { WalletAddressDirective } from '@/directives/wallet-address.directive';

import { Sorts } from '@/models/pipes';
import { TokenIdParsePipe } from '@/pipes/token-id-parse.pipe';

import { GlobalState, Notification, TraitFilter } from '@/models/global-state';
import { Phunk } from '@/models/db';

import { DataService } from '@/services/data.service';
import { Web3Service } from '@/services/web3.service';

import { SlideoutComponent } from '@/components/slideout/slideout.component';

import { WeiToEthPipe } from '@/pipes/wei-to-eth.pipe';

import * as appStateSelectors from '@/state/selectors/app-state.selectors';
import * as appStateActions from '@/state/actions/app-state.actions';
import * as dataStateSelectors from '@/state/selectors/data-state.selectors';
import * as marketStateSelectors from '@/state/selectors/market-state.selectors';
import * as marketStateActions from '@/state/actions/market-state.actions';

import { environment } from 'src/environments/environment';

import { firstValueFrom, map, tap } from 'rxjs';
import { CalcPipe } from '@/pipes/calculate.pipe';
import { FormatCashPipe } from '@/pipes/format-cash.pipe';

const defaultActionState = {
  canList: false,
  canTransfer: false,
  canWithdraw: false,
  canEscrow: false,
};

@Component({
  selector: 'app-phunk-grid-view',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    LazyLoadImageModule,
    NgxPaginationModule,
    NgSelectModule,
    FormsModule,
    ReactiveFormsModule,

    PhunkGridComponent,
    MarketFiltersComponent,
    ModalComponent,
    SlideoutComponent,

    WalletAddressDirective,
    WeiToEthPipe,
    CalcPipe,
    FormatCashPipe,

    TokenIdParsePipe,
  ],
  templateUrl: './market.component.html',
  styleUrls: ['./market.component.scss']
})

export class MarketComponent {

  @ViewChild('transferAddressInput') transferAddressInput!: ElementRef<HTMLInputElement>;

  env = environment;

  escrowAddress = environment.marketAddress;

  marketTitles: any = {
    all: 'All %collectionName%s',
    listings: ' %collectionName%s for Sale',
    bids: 'Current Bids',
    owned: ' %collectionName%s Owned'
  };

  sorts: { label: string, value: Sorts }[] = [
    { label: 'Price Low', value: 'price-low' },
    { label: 'Price High', value: 'price-high' },
    // { label: 'Recent', value: 'recent' },
    { label: 'Token ID', value: 'id' }
  ];
  activeSortModel: any = this.sorts[0];
  filtersVisible: boolean = false;

  bulkActionsForm = this.fb.group({
    listingPhunks: this.fb.array([]),
    transferPhunks: this.fb.array([]),
    escrowPhunks: this.fb.array([]),
    withdrawPhunks: this.fb.array([]),
    buyPhunks: this.fb.array([]),
  });

  selectedPhunksFormArray: FormArray = this.fb.array([]);
  transferAddress = new FormControl<string | null>('');

  selected: { [string: Phunk['hashId']]: Phunk } = {};
  deselected: Phunk[] = [];
  selectedValue: string = '';

  selectMutipleActive: boolean = false;
  selectAll: boolean = false;

  isListingBulk: boolean = false;
  isTransferingBulk: boolean = false;
  isEscrowingBulk: boolean = false;
  isWithdrawingBulk: boolean = false;
  isBuyingBulk: boolean = false;

  actionsState: {
    canList: boolean,
    canTransfer: boolean,
    canWithdraw: boolean,
    canEscrow: boolean,
  } = defaultActionState;

  activeCollection$ = this.store.select(dataStateSelectors.selectActiveCollection);
  walletAddress$ = this.store.select(appStateSelectors.selectWalletAddress);
  slidseoutActive$ = this.store.select(appStateSelectors.selectSlideoutActive).pipe(
    tap((slideoutActive: boolean) => {
      if (!slideoutActive) this.resetState();
    })
  );

  marketType$ = this.store.select(marketStateSelectors.selectMarketType);
  activeMarketRouteData$ = this.store.select(marketStateSelectors.selectActiveMarketRouteData);
  activeTraitFilters$ = this.store.select(marketStateSelectors.selectActiveTraitFilters).pipe(
    map((traitFilters: any) => {
      const traitFiltersCopy = { ...traitFilters };
      delete traitFiltersCopy['address'];
      return traitFiltersCopy as TraitFilter;
    })
  );
  activeSort$ = this.store.select(marketStateSelectors.selectActiveSort).pipe(
    tap((sort: any) => this.activeSortModel = sort)
  );

  ceil = Math.ceil;
  objectKeys = Object.keys;
  objectValues = Object.values;

  usd$ = this.store.select(dataStateSelectors.selectUsd);

  constructor(
    private store: Store<GlobalState>,
    public route: ActivatedRoute,
    public dataSvc: DataService,
    public web3Svc: Web3Service,
    private fb: FormBuilder
  ) {}

  setSort($event: any): void {
    this.store.dispatch(marketStateActions.setActiveSort({ activeSort: $event }));
  }

  async batchAction(type: 'transfer' | 'escrow' | 'withdraw' | 'list' | 'sweep'): Promise<void> {
    if (!Object.keys(this.selected).length) return;

    if (type === 'sweep') await this.buySelected();
    if (type === 'transfer') await this.transferSelected();
    if (type === 'escrow') await this.escrowSelected();
    if (type === 'list') await this.listSelected();
    if (type === 'withdraw') await this.withdrawSelected();
  }

  // Actions
  async buySelected(): Promise<void> {
    this.isBuyingBulk = true;
    this.store.dispatch(appStateActions.setSlideoutActive({ slideoutActive: true }));

    const { inEscrow, notInEscrow, invalid } = await this.getSelectedEscrowed(false, false, true);
    this.deselected = [ ...notInEscrow, ...invalid ];

    const formArray = this.fb.array(inEscrow.map((phunk: Phunk) => this.fb.group({
      phunkId: [phunk.tokenId],
      hashId: [phunk.hashId],
      sha: [phunk.sha],
      listing: {
        minValue: [phunk.listing?.minValue]
      },
    }))) as FormArray;

    this.bulkActionsForm.setControl('buyPhunks', formArray);
    this.selectedPhunksFormArray = this.bulkActionsForm.get('buyPhunks') as FormArray;
  }

  async transferSelected(): Promise<void> {
    this.isTransferingBulk = true;
    this.store.dispatch(appStateActions.setSlideoutActive({ slideoutActive: true }));

    const { inEscrow, notInEscrow, invalid } = await this.getSelectedEscrowed(false, true);
    this.deselected = [ ...inEscrow, ...invalid ];

    const formArray = this.fb.array(notInEscrow.map((phunk: Phunk) => this.fb.group({
      phunkId: [phunk.tokenId],
      hashId: [phunk.hashId],
      sha: [phunk.sha],
      listPrice: [''],
    }))) as FormArray;

    this.bulkActionsForm.setControl('transferPhunks', formArray);
    this.selectedPhunksFormArray = this.bulkActionsForm.get('transferPhunks') as FormArray;

    setTimeout(() => this.transferAddressInput.nativeElement.focus(), 0);
  }

  async listSelected(): Promise<void> {
    this.isListingBulk = true;
    this.store.dispatch(appStateActions.setSlideoutActive({ slideoutActive: true }));

    const { inEscrow, notInEscrow } = await this.getSelectedEscrowed();
    this.deselected = notInEscrow;

    const formArray = this.fb.array(inEscrow.map((phunk: Phunk) => this.fb.group({
      phunkId: [phunk.tokenId],
      hashId: [phunk.hashId],
      sha: [phunk.sha],
      listing: [phunk.listing],
      listPrice: [''],
    }))) as FormArray;

    this.bulkActionsForm.setControl('listingPhunks', formArray);
    this.selectedPhunksFormArray = this.bulkActionsForm.get('listingPhunks') as FormArray;
  }

  async escrowSelected(): Promise<void> {
    this.isEscrowingBulk = true;
    this.store.dispatch(appStateActions.setSlideoutActive({ slideoutActive: true }));

    const { inEscrow, notInEscrow, invalid } = await this.getSelectedEscrowed(true, true);
    this.deselected = [ ...inEscrow, ...invalid ];

    const formArray = this.fb.array(notInEscrow.map((phunk: Phunk) => this.fb.group({
      phunkId: [phunk.tokenId],
      hashId: [phunk.hashId],
      slug: [phunk.slug],
      sha: [phunk.sha],
      listPrice: [''],
    }))) as FormArray;

    this.bulkActionsForm.setControl('escrowPhunks', formArray);
    this.selectedPhunksFormArray = this.bulkActionsForm.get('escrowPhunks') as FormArray;
  }

  async withdrawSelected(): Promise<void> {
    this.isWithdrawingBulk = true;
    this.store.dispatch(appStateActions.setSlideoutActive({ slideoutActive: true }));

    const { inEscrow, notInEscrow } = await this.getSelectedEscrowed();
    this.deselected = notInEscrow;

    const formArray = this.fb.array(inEscrow.map((phunk: Phunk) => this.fb.group({
      phunkId: [phunk.tokenId],
      hashId: [phunk.hashId],
      sha: [phunk.sha],
      listing: [phunk.listing],
      listPrice: [''],
    }))) as FormArray;

    this.bulkActionsForm.setControl('withdrawPhunks', formArray);
    this.selectedPhunksFormArray = this.bulkActionsForm.get('withdrawPhunks') as FormArray;
  }

  async submitBatchTransfer(): Promise<void> {

    if (!this.bulkActionsForm.value.transferPhunks) return;
    const hashIds = this.bulkActionsForm.value.transferPhunks.map((phunk: any) => phunk.hashId);

    if (!hashIds?.length) return;
    if (!this.transferAddress.value) return;

    let notification: Notification = {
      id: Date.now(),
      type: 'wallet',
      function: 'transferPhunk',
      hashId: hashIds[0],
      hashIds,
      isBatch: true,
    };

    this.store.dispatch(appStateActions.upsertNotification({ notification }));
    this.closeModal();

    try {
      let toAddress: string | null = this.transferAddress.value;
      toAddress = await this.web3Svc.verifyAddressOrEns(toAddress);
      if (!toAddress) throw new Error('Invalid address');

      const hash = await this.web3Svc.batchTransferPhunks(hashIds, toAddress);
      if (!hash) throw new Error('Transaction failed');

      notification = {
        ...notification,
        type: 'pending',
        hash,
      };
      this.store.dispatch(appStateActions.upsertNotification({ notification }));

      const receipt = await this.web3Svc.pollReceipt(hash!);
      notification = {
        ...notification,
        type: 'complete',
        hash: receipt.transactionHash,
      };
      this.store.dispatch(appStateActions.upsertNotification({ notification }));
      this.clearSelectedAndClose();
    } catch (err) {
      console.log(err);
      notification = {
        ...notification,
        type: 'error',
        detail: err,
      };
      this.store.dispatch(appStateActions.upsertNotification({ notification }));
    }
  }

  async submitBatchListing(): Promise<void> {
    if (!this.bulkActionsForm.value.listingPhunks) return;

    const newListings = this.bulkActionsForm.value.listingPhunks
      .filter((phunk: any) => phunk.listPrice);

    if (!newListings.length) return;

    const listings = newListings.map((phunk: any) => ({ hashId: phunk.hashId, listPrice: phunk.listPrice }))|| [];
    const hashIds = newListings.map((phunk: any) => phunk.hashId) || [];

    if (!hashIds?.length) return;

    let notification: Notification = {
      id: Date.now(),
      type: 'wallet',
      function: 'offerPhunkForSale',
      hashId: hashIds[0],
      hashIds,
      isBatch: true,
    };

    this.store.dispatch(appStateActions.upsertNotification({ notification }));
    this.closeModal();

    try {
      const hash = await this.web3Svc.batchOfferPhunkForSale(
        listings.map(phunk => phunk.hashId),
        listings.map(phunk => phunk.listPrice)
      );
      if (!hash) throw new Error('Transaction failed');

      notification = {
        ...notification,
        type: 'pending',
        hash,
      };
      this.store.dispatch(appStateActions.upsertNotification({ notification }));

      const receipt = await this.web3Svc.pollReceipt(hash!);
      notification = {
        ...notification,
        type: 'complete',
        hash: receipt.transactionHash,
      };
      this.store.dispatch(appStateActions.upsertNotification({ notification }));

      this.clearSelectedAndClose();
    } catch (err) {
      console.log(err);
      notification = {
        ...notification,
        type: 'error',
        detail: err,
      };
      this.store.dispatch(appStateActions.upsertNotification({ notification }));
    }
  }

  async submitBatchEscrow(): Promise<void> {
    if (!this.bulkActionsForm.value.escrowPhunks) return;

    const { notInEscrow } = await this.getSelectedEscrowed();

    const selected: { [string: Phunk['hashId']]: Phunk } = {};
    notInEscrow.forEach((phunk: Phunk) => selected[phunk.hashId] = phunk);
    this.selected = selected;

    const hashIds = Object.values(selected).map((phunk: Phunk) => phunk.hashId);
    const hexString = Object.keys(selected).map(hashId => hashId?.substring(2)).join('');

    const hex = `0x${hexString}`;

    let notification: Notification = {
      id: Date.now(),
      type: 'wallet',
      function: 'sendToEscrow',
      hashId: hashIds[0],
      hashIds,
      isBatch: true,
    }

    this.store.dispatch(appStateActions.upsertNotification({ notification }));
    this.closeModal();

    try {
      if (!hashIds?.length || hex === '0x') throw new Error('Invalid selection');

      const hash = await this.web3Svc.transferPhunk(hex, this.escrowAddress);
      if (!hash) throw new Error('Transaction failed');

      notification = {
        ...notification,
        type: 'pending',
        hash,
      };
      this.store.dispatch(appStateActions.upsertNotification({ notification }));

      const receipt = await this.web3Svc.pollReceipt(hash!);
      notification = {
        ...notification,
        type: 'complete',
        hash: receipt.transactionHash,
      };
      this.store.dispatch(appStateActions.upsertNotification({ notification }));
      this.clearSelectedAndClose();
    } catch (err) {
      console.log(err);
      notification = {
        ...notification,
        type: 'error',
        detail: err,
      };
      this.store.dispatch(appStateActions.upsertNotification({ notification }));
    }
  }

  async submitBatchWithdraw(): Promise<void> {
    if (!this.bulkActionsForm.value.withdrawPhunks) return;

    const { inEscrow } = await this.getSelectedEscrowed();

    const selected: { [string: Phunk['hashId']]: Phunk } = {};
    inEscrow.forEach((phunk: Phunk) => selected[phunk.hashId] = phunk);
    this.selected = selected;

    const hashIds = Object.values(selected).map((phunk: Phunk) => phunk.hashId);

    let notification: Notification = {
      id: Date.now(),
      type: 'wallet',
      function: 'withdrawPhunk',
      hashId: hashIds[0],
      hashIds,
      isBatch: true,
    };

    this.store.dispatch(appStateActions.upsertNotification({ notification }));
    this.closeModal();

    try {
      if (!hashIds?.length) throw new Error('Invalid selection');

      const hash = await this.web3Svc.withdrawBatch(Object.keys(selected));
      if (!hash) throw new Error('Transaction failed');

      notification = {
        ...notification,
        type: 'pending',
        hash,
      };
      this.store.dispatch(appStateActions.upsertNotification({ notification }));

      const receipt = await this.web3Svc.pollReceipt(hash!);
      notification = {
        ...notification,
        type: 'complete',
        hash: receipt.transactionHash,
      };
      this.store.dispatch(appStateActions.upsertNotification({ notification }));
      this.clearSelectedAndClose();
    } catch (err) {
      console.log(err);
      notification = {
        ...notification,
        type: 'error',
        detail: err,
      };
      this.store.dispatch(appStateActions.upsertNotification({ notification }));
    }
  }

  async submitBatchBuy(): Promise<void> {
    if (!this.bulkActionsForm.value.buyPhunks) return;

    const { inEscrow } = await this.getSelectedEscrowed(false, false, true);

    const selected: { [string: Phunk['hashId']]: Phunk } = {};
    inEscrow.forEach((phunk: Phunk) => selected[phunk.hashId] = phunk);
    this.selected = selected;

    const hashIds = Object.keys(selected);

    let notification: Notification = {
      id: Date.now(),
      type: 'wallet',
      function: 'buyPhunk',
      hashId: hashIds[0],
      hashIds,
      isBatch: true,
    };

    this.store.dispatch(appStateActions.upsertNotification({ notification }));
    this.closeModal();

    try {
      if (!hashIds?.length) throw new Error('One or more items are no longer for sale.');

      const hash = await this.web3Svc.batchBuyPhunks(Object.values(selected));
      if (!hash) throw new Error('Transaction failed');

      notification = {
        ...notification,
        type: 'pending',
        hash,
      };
      this.store.dispatch(appStateActions.upsertNotification({ notification }));

      const receipt = await this.web3Svc.pollReceipt(hash!);
      notification = {
        ...notification,
        type: 'complete',
        hash: receipt.transactionHash,
      };
      this.store.dispatch(appStateActions.upsertNotification({ notification }));
      this.clearSelectedAndClose();
    } catch (err) {
      console.log(err);
      notification = {
        ...notification,
        type: 'error',
        detail: err,
      };
      this.store.dispatch(appStateActions.upsertNotification({ notification }));
    }
  }

  selectedChange($event: any): void {
    this.selectedValue = Object.values(this.selected).reduce(
      (acc: number, phunk: Phunk) => acc += Number(phunk.listing?.minValue || '0'),
    0).toString();

    this.actionsState = {
      canList: false,
      canTransfer: false,
      canWithdraw: false,
      canEscrow: false,
    };

    Object.values(this.selected).forEach((phunk: Phunk) => {
      // console.log({phunk});
      if (phunk.isEscrowed) {
        this.actionsState.canWithdraw = true;
        this.actionsState.canList = true;
      } else {
        this.actionsState.canTransfer = true;
        this.actionsState.canEscrow = true;
      };
    });
    this.actionsState = { ...this.actionsState };
  }

  setSelectActive() {
    this.selectMutipleActive = !this.selectMutipleActive;
    this.selectAll = false;
    if (!this.selectMutipleActive) {
      this.selected = {};
      this.deselected = [];
    }
  }

  clearSelectedAndClose() {
    this.selectMutipleActive = false;
    this.selectAll = false;
    this.selected = {};
    this.actionsState = defaultActionState;
  }

  closeModal(): void {
    this.store.dispatch(appStateActions.setSlideoutActive({ slideoutActive: false }));
  }

  copyToNext(index: number) {
    this.selectedPhunksFormArray.controls[index + 1].get('listPrice')?.setValue(
      this.selectedPhunksFormArray.controls[index].get('listPrice')?.value
    );
  }

  resetState() {
    this.isListingBulk = false;
    this.isTransferingBulk = false;
    this.isEscrowingBulk = false;
    this.isWithdrawingBulk = false;
    this.isBuyingBulk = false;
    this.selectedPhunksFormArray = this.fb.array([]);
  }

  // Submissions
  async getSelectedEscrowed(
    checkPrevOwner = true,
    checkConsensus = false,
    removeOwnedItems = false
  ): Promise<{ notInEscrow: Phunk[], inEscrow: Phunk[], invalid: Phunk[]}> {

    let selectedHashIds = Object.keys(this.selected);

    let inEscrow: Phunk[] = [];
    const escrow = await firstValueFrom(
      this.dataSvc.phunksAreInEscrow(selectedHashIds, checkPrevOwner)
    );

    let notInEscrow: Phunk[] = [];
    const noEscrow = selectedHashIds
      .filter(hashId => !escrow.find((phunk: Phunk) => phunk.hashId === hashId))
      .map(hashId => this.selected[hashId]);

    let invalid: Phunk[] = [];
    if (checkConsensus) {
      const checkPromises = selectedHashIds.map(async (hashId: string) => {
        const phunk = this.selected[hashId];
        const hasConsensus = await this.dataSvc.checkConsensus(hashId, phunk.owner, phunk.prevOwner);
        return { hashId, hasConsensus };
      });

      const checkResults: { hashId: string, hasConsensus: boolean }[] = await Promise.all(checkPromises);
      invalid = checkResults.filter(result => !result.hasConsensus).map(result => this.selected[result.hashId]);
    }

    if (removeOwnedItems) {
      const address = await this.web3Svc.getActiveWalletAddress();
      const owned = [...escrow, ...noEscrow].filter((phunk: Phunk) => phunk.prevOwner?.toLowerCase() === address?.toLowerCase());
      invalid = [...invalid, ...owned];
    }

    inEscrow = escrow
      .filter((phunk: Phunk) => !invalid.find((invalidPhunk: Phunk) => invalidPhunk.hashId === phunk.hashId));

    notInEscrow = noEscrow
      .filter((phunk: Phunk) => !invalid.find((invalidPhunk: Phunk) => invalidPhunk.hashId === phunk.hashId));

    return { notInEscrow, inEscrow, invalid };
  }

  async checkConsenus(hashId: string, owner: string, prevOwner: string | null): Promise<boolean> {
    const consensus = await this.dataSvc.checkConsensus(hashId, owner, prevOwner);
    if (!consensus) throw new Error('Consensus not reached. Contact Support @etherphunks');
    return consensus;
  }
}
