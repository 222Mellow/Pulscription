import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';

import { LazyLoadImageModule } from 'ng-lazyload-image';

import { WalletAddressDirective } from '@/directives/wallet-address.directive';

import { WeiToEthPipe } from '@/pipes/wei-to-eth.pipe';
import { FormatCashPipe } from '@/pipes/format-cash.pipe';
import { CamelCase2TitleCase } from '@/pipes/cc2tc.pipe';

import { DataService } from '@/services/data.service';

import { environment } from 'src/environments/environment';
import { ZERO_ADDRESS } from '@/constants/utils';

import { BehaviorSubject, catchError, filter, map, of, switchMap } from 'rxjs';
import { Store } from '@ngrx/store';
import { GlobalState } from '@/models/global-state';
import { Phunk } from '@/models/db';

@Component({
  standalone: true,
  imports: [
    CommonModule,
    HttpClientModule,
    RouterModule,

    LazyLoadImageModule,

    WalletAddressDirective,

    WeiToEthPipe,
    FormatCashPipe,
    CamelCase2TitleCase
  ],
  selector: 'app-tx-history',
  templateUrl: './tx-history.component.html',
  styleUrls: ['./tx-history.component.scss']
})

export class TxHistoryComponent implements OnChanges {

  ZERO_ADDRESS = ZERO_ADDRESS;
  explorerUrl = environment.explorerUrl;

  @Input() phunk!: Phunk;

  private fetchTxHistory = new BehaviorSubject<string | null>(null);
  fetchTxHistory$ = this.fetchTxHistory.asObservable();

  tokenSales$ = this.fetchTxHistory$.pipe(
    filter((hashId) => !!hashId),
    switchMap((hashId) => this.dataSvc.fetchSingleTokenEvents(hashId!)),
    catchError(error => {
      console.error('Error fetching transaction history', error);
      return of([]);
    })
  );

  constructor(
    private store: Store<GlobalState>,
    private dataSvc: DataService,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.phunk && changes.phunk.currentValue) {
      this.fetchTxHistory.next(this.phunk.hashId);
    }
  }
}
