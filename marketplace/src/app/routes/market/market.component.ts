import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { NgxPaginationModule } from 'ngx-pagination';
import { LazyLoadImageModule } from 'ng-lazyload-image';
import { NgSelectModule } from '@ng-select/ng-select';

import { PhunkGridComponent } from '@/components/phunk-grid/phunk-grid.component';
import { MarketFiltersComponent } from '@/components/market-filters/market-filters.component';

import { WalletAddressDirective } from '@/directives/wallet-address.directive';

import { Sorts } from '@/models/pipes';

import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { environment } from 'src/environments/environment';
import { Store } from '@ngrx/store';
import { GlobalState } from '@/models/global-state';
import { Phunk } from '@/models/graph';
import { DataService } from '@/services/data.service';
import { ModalComponent } from '@/components/modal/modal.component';
import { Web3Service } from '@/services/web3.service';

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

    WalletAddressDirective,

    PhunkGridComponent,
    MarketFiltersComponent,
    ModalComponent,
  ],
  templateUrl: './market.component.html',
  styleUrls: ['./market.component.scss']
})

export class MarketComponent {

  escrowAddress = environment.phunksMarketAddress;

  marketTitles: any = {
    all: 'All EtherPhunks',
    listings: 'EtherPhunks for Sale',
    bids: 'Current Bids',
    owned: 'EtherPhunks Owned'
  };

  sorts: { label: string, value: Sorts }[] = [
    { label: 'Price Low', value: 'price-low' },
    { label: 'Price High', value: 'price-high' },
    { label: 'Recent', value: 'recent' },
    { label: 'Token ID', value: 'id' }
  ];

  private activeSort = new BehaviorSubject(this.sorts[0]);
  activeSort$ = this.activeSort.asObservable();
  activeSortModel: any = this.sorts[0];

  currentPage: number = 1;
  filtersVisible: boolean = false;

  transferModalActive: boolean = false;

  selectMutipleActive: boolean = false;
  selectAll: boolean = false;
  selectedPhunks: Phunk['hashId'][] = [];

  walletAddress$ = this.store.select(state => state.appState.walletAddress);
  activeMarketRouteData$ = this.store.select(state => state.appState.activeMarketRouteData);
  marketType$ = this.store.select(state => state.appState.marketType);

  constructor(
    private store: Store<GlobalState>,
    public route: ActivatedRoute,
    private dataSvc: DataService,
    private web3Svc: Web3Service
  ) {}

  setSort($event: any): void {
    this.activeSort.next({ ...$event });
  }

  pageChanged($event: any) {
    this.currentPage = $event;
  }

  setSelectMiltiple() {
    this.selectMutipleActive = !this.selectMutipleActive;
    this.selectAll = false;
  }

  async batchAction(type: 'transfer' | 'escrow' | 'withdraw'): Promise<void> {
    if (!this.selectedPhunks.length) return;

    this.transferModalActive = true;

    if (type === 'escrow') await this.batchTransfer(this.escrowAddress);
    if (type === 'withdraw') await this.withdrawBatch();

  }

  async batchTransfer(toAddress: string): Promise<string | undefined> {

    const canTransfer = await firstValueFrom(
      this.dataSvc.phunksCanTransfer(this.selectedPhunks)
    );

    const selected = [ ...canTransfer.map((phunk: Phunk) => phunk.hashId) ];
    this.selectedPhunks = selected;

    const hexString = selected.map(hashId => hashId?.substring(2)).join('');
    const hex = `0x${hexString}`;

    return await this.web3Svc.transferPhunk(hex, toAddress);
  }

  async withdrawBatch(): Promise<string | undefined> {

      const canWithdraw = await firstValueFrom(
        this.dataSvc.phunksCanWithdraw(this.selectedPhunks)
      );

      const selected = [ ...canWithdraw.map((phunk: Phunk) => phunk.hashId) ];
      this.selectedPhunks = selected;

      return await this.web3Svc.withdrawBatch(selected);
    }

  closeModal(): void {
    this.transferModalActive = false;
  }
}
