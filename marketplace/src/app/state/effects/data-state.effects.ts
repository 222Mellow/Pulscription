import { Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import { Actions, createEffect, ofType } from '@ngrx/effects';

import { GlobalState } from '@/models/global-state';
import { Attribute, Event, Phunk } from '@/models/db';

import { DataService } from '@/services/data.service';

import * as appStateActions from '@/state/actions/app-state.actions';
import * as appStateSelectors from '@/state/selectors/app-state.selectors';

import * as dataStateActions from '@/state/actions/data-state.actions';
import * as dataStateSelectors from '@/state/selectors/data-state.selectors';

import { asyncScheduler, catchError, filter, forkJoin, from, map, mergeMap, of, switchMap, tap, throttleTime, withLatestFrom } from 'rxjs';

import { environment } from 'src/environments/environment';

@Injectable()
export class DataStateEffects {

  dbEventTriggered$ = createEffect(() => this.actions$.pipe(
    ofType(dataStateActions.dbEventTriggered),
    // Start with the throttle
    throttleTime(3000, asyncScheduler, {
      leading: true, // emit the first value immediately
      trailing: true // emit the last value in the window
    }),
    // Now, inside the throttle, apply debounce to catch any final burst of events
    // switchMap(action =>
    //   timer(3000).pipe( // 3 second after the last burst of events
    //     map(() => action),
    //     // Start with the first event
    //     startWith(action)
    //   )
    // ),
    // tap((action) => console.log('dbEventTriggered', action)),
    withLatestFrom(this.store.select(appStateSelectors.selectWalletAddress)),
    map(([action]) => action.payload.new as Event),
    filter((newData) => !!newData),
    withLatestFrom(
      this.store.select(dataStateSelectors.selectSinglePhunk),
      this.store.select(appStateSelectors.selectWalletAddress),
      this.store.select(appStateSelectors.selectactiveEventTypeFilter)
    ),
    tap(([newData, singlePhunk, address, activeEventTypeFilter]) => {

      this.checkEventForPurchaseFromUser(newData, address);
      this.checkEventIsActiveSinglePhunk(newData, singlePhunk);

      this.store.dispatch(dataStateActions.fetchOwnedPhunks());
      this.store.dispatch(dataStateActions.fetchMarketData());
      this.store.dispatch(appStateActions.setEventTypeFilter({ eventTypeFilter: activeEventTypeFilter }));
    }),
  ), { dispatch: false });

  onBlockNumber$ = createEffect(() => this.actions$.pipe(
    ofType(appStateActions.newBlock),
    withLatestFrom(this.store.select(appStateSelectors.selectWalletAddress)),
    switchMap(([action, address]) => {
      const currentBlock = action.blockNumber;
      const storedBlock = localStorage.getItem('EtherPhunks_currentBlock');
      // console.log('onBlockNumber', currentBlock, storedBlock);
      if (storedBlock && (currentBlock - Number(storedBlock)) > 2) {
        return this.dataSvc.fetchMissedEvents(address, Number(storedBlock)).pipe(
          tap((events) => {
            for (const event of events) this.checkEventForPurchaseFromUser(event, address);
          }),
          catchError((err) => of([])),
        );
      }
      return of([]);
    }),
    withLatestFrom(this.store.select(appStateSelectors.selectBlockNumber)),
    tap(([_, blockNumber]) => localStorage.setItem('EtherPhunks_currentBlock', JSON.stringify(blockNumber))),
  ), { dispatch: false });

  fetchEvents$ = createEffect(() => this.actions$.pipe(
    ofType(appStateActions.setEventTypeFilter),
    // tap((action) => console.log('fetchEvents', action)),
    switchMap((action) => this.dataSvc.fetchEvents(6, action.eventTypeFilter)),
    map((events) => dataStateActions.setEvents({ events })),
  ));

  fetchTxHistory$ = createEffect(() => this.actions$.pipe(
    ofType(dataStateActions.fetchTxHistory),
    filter((action) => !!action.hashId),
    switchMap((action) => this.dataSvc.fetchSingleTokenEvents(action.hashId)),
    map((txHistory) => dataStateActions.setTxHistory({ txHistory })),
  ));

  // FIXME: Type change
  fetchAllPhunks$ = createEffect(() => this.actions$.pipe(
    ofType(dataStateActions.fetchAllPhunks),
    switchMap(() => this.dataSvc.getAttributes()),
    map((attributes) => {
      return Object.keys(attributes).map((k) => {
        return {
          hashId: '',
          phunkId: Number(k),
          createdAt: new Date(),
          owner: '',
          prevOwner: '',

          attributes: (attributes as any)[k] as Attribute[],
        };
      });
    }),
    map((phunks) => dataStateActions.setAllPhunks({ allPhunks: phunks })),
  ));

  fetchMarketData$ = createEffect(() => this.actions$.pipe(
    ofType(dataStateActions.fetchMarketData),
    switchMap(() => this.dataSvc.fetchMarketData()),
    map(([listings, bids]) => {
      const merged: any = {};

      for (const listing of listings) merged[listing.hashId] = {
        ...merged[listing.hashId],
        phunkId: listing[`phunks${this.dataSvc.prefix}`].phunkId,
        hashId: listing.hashId,
        listing,
      };
      for (const bid of bids) merged[bid.hashId] = {
        ...merged[bid.hashId],
        phunkId: bid[`phunks${this.dataSvc.prefix}`].phunkId,
        hashId: bid.hashId,
        bid,
      };

      const marketData = Object.values(merged);
      return marketData;
    }),
    switchMap((res: any) => this.dataSvc.addAttributes(res)),
    map((marketData: Phunk[]) => {
      const listingsData = marketData.filter((item: any) => item.listing && item.listing.value !== '0');
      const bidsData = marketData.filter((item: any) => item.bid && item.bid.value !== '0');
      return { marketData, listingsData, bidsData };
    }),
    // tap((res) => console.log('fetchMarketData', res)),
    mergeMap(({ marketData, listingsData, bidsData }) => {
      return [
        dataStateActions.setMarketData({ marketData }),
        dataStateActions.setListings({ listings: listingsData }),
        dataStateActions.setBids({ bids: bidsData })
      ];
    })
  ));

  fetchSinglePhunk$ = createEffect(() => this.actions$.pipe(
    ofType(dataStateActions.fetchSinglePhunk),
    // delay(1000),
    switchMap((action) => this.dataSvc.fetchSinglePhunk(action.phunkId)),
    // tap((res) => console.log('fetchSinglePhunk', res)),
    map((phunk: Phunk) => {
      return {
        phunkId: phunk.phunkId,
        createdAt: phunk.createdAt,
        hashId: phunk.hashId,
        owner: phunk.owner,
        prevOwner: phunk.prevOwner,
        isEscrowed: phunk.owner === environment.phunksMarketAddress,
        attributes: [],
      };
    }),
    switchMap((res: Phunk) => forkJoin([
      this.dataSvc.addAttributes([res]),
      from(Promise.all([
        this.dataSvc.getListingForPhunkId(res.hashId),
        this.dataSvc.getBidForPhunkId(res.hashId),
      ]))
    ])),
    map(([[res], [listing, bid]]) => ({
      ...res,
      listing,
      bid,
      attributes: [ ...(res.attributes || []) ].sort((a: Attribute, b: Attribute) => {
        if (a.k === "Sex") return -1;
        if (b.k === "Sex") return 1;
        return 0;
      }),
    })),
    map((phunk) => dataStateActions.setSinglePhunk({ phunk })),
  ));

  refreshSinglePhunk$ = createEffect(() => this.actions$.pipe(
    ofType(dataStateActions.refreshSinglePhunk),
    withLatestFrom(this.store.select(dataStateSelectors.selectSinglePhunk)),
    // tap(([action, phunk]) => console.log('refreshSinglePhunk', action, phunk)),
    filter(([action, phunk]) => !!phunk),
    map(([action, phunk]) => dataStateActions.fetchSinglePhunk({ phunkId: `${phunk!.hashId}` })),
  ));

  fetchOwnedPhunks$ = createEffect(() => this.actions$.pipe(
    ofType(dataStateActions.fetchOwnedPhunks),
    withLatestFrom(this.store.select(appStateSelectors.selectWalletAddress)),
    filter(([_, address]) => !!address),
    switchMap(([_, address]) => this.dataSvc.fetchOwned(address)),
    map((phunks) => dataStateActions.setOwnedPhunks({ ownedPhunks: phunks })),
  ));

  fetchUserOpenBids$ = createEffect(() => this.actions$.pipe(
    ofType(dataStateActions.fetchUserOpenBids),
    switchMap(() => this.store.select(appStateSelectors.selectWalletAddress).pipe(
      filter((address) => !!address),
      switchMap((address) => this.dataSvc.fetchUserOpenBids(address)),
    )),
    map((userOpenBids) => dataStateActions.setUserOpenBids({ userOpenBids })),
  ));

  constructor(
    private store: Store<GlobalState>,
    private actions$: Actions,
    private dataSvc: DataService,
  ) {}

  checkEventForPurchaseFromUser(event: Event, userAddress: string) {
    if (!userAddress) return;
    if (event.type === 'PhunkBought' && event.from.toLowerCase() === userAddress?.toLowerCase()) {
      // This phunk was bought FROM the active user.
      // We can notify them of this purchase
      this.store.dispatch(appStateActions.upsertTransaction({
        transaction: {
          id: event.blockTimestamp ? new Date(event.blockTimestamp).getTime() : Date.now(),
          type: 'event',
          function: 'purchased',
          phunkId: event.phunkId!,
          hash: event.txHash,
          isNotification: true,
          detail: event,
        }
      }));
    }
  }

  checkEventIsActiveSinglePhunk(event: Event, singlePhunk: Phunk | null) {
    if (!singlePhunk) return;
    if (event.phunkId === singlePhunk.phunkId) {
      this.store.dispatch(dataStateActions.refreshSinglePhunk());
    }
  }

  checkIsOrWasOwnedPhunk(event: Event, ownedPhunks: Phunk[]) {
    const ownedPhunk = ownedPhunks.find((phunk) => phunk.phunkId === event.phunkId);
    if (ownedPhunk) {
      this.store.dispatch(dataStateActions.fetchOwnedPhunks());
    }
  }
}
