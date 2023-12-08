import { Component, ElementRef, EventEmitter, Input, OnChanges, Output, QueryList, SimpleChanges, ViewChildren } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { Store } from '@ngrx/store';
import { NgxPaginationModule } from 'ngx-pagination';
import { LazyLoadImageModule } from 'ng-lazyload-image';
import { IntersectionObserverModule } from '@ng-web-apis/intersection-observer';

import { ViewType } from '@/models/view-types';
import { Phunk } from '@/models/db';
import { MarketTypes, Sort, Sorts } from '@/models/pipes';
import { GlobalState } from '@/models/global-state';

import { DataService } from '@/services/data.service';

import { TokenIdParsePipe } from '@/pipes/token-id-parse.pipe';
import { WeiToEthPipe } from '@/pipes/wei-to-eth.pipe';
import { FormatCashPipe } from '@/pipes/format-cash.pipe';
import { SortPipe } from '@/pipes/sort.pipe';
import { PropertiesPipe } from '@/pipes/properties';

import { environment } from 'src/environments/environment';

import * as dataStateSelectors from '@/state/selectors/data-state.selectors';
import * as appStateSelectors from '@/state/selectors/app-state.selectors';

import { filter, map, tap } from 'rxjs';

let PAGE_SIZE = 36;

@Component({
  selector: 'app-phunk-grid',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    LazyLoadImageModule,
    NgxPaginationModule,
    IntersectionObserverModule,

    TokenIdParsePipe,
    WeiToEthPipe,
    FormatCashPipe,
    SortPipe,
    PropertiesPipe
  ],
  host:  {
    '[class.selectable]': 'selectable',
    '[class]': 'viewType',
  },
  templateUrl: './phunk-grid.component.html',
  styleUrls: ['./phunk-grid.component.scss']
})

export class PhunkGridComponent implements OnChanges {

  @ViewChildren('phunkCheck') phunkCheck!: QueryList<ElementRef<HTMLInputElement>>;

  escrowAddress = environment.marketAddress;

  @Input() marketType!: MarketTypes;
  @Input() activeSort!: Sort['value'];

  @Input() phunkData: Phunk[] = [];
  @Input() viewType: ViewType = 'market';
  @Input() limit: number = 110;
  @Input() currentPage: number = 1;
  @Input() showLabels: boolean = true;
  @Input() observe: boolean = false;

  @Input() selectable: boolean = false;
  @Input() selectAll: boolean = false;

  @Output() selectedChange = new EventEmitter<{ [string: Phunk['hashId']]: Phunk }>();
  @Input() selected: { [string: Phunk['hashId']]: Phunk } = {};

  limitArr = Array.from({length: this.limit}, (_, i) => i);

  usd$ = this.store.select(dataStateSelectors.selectUsd);
  activeTraitFilters$ = this.store.select(appStateSelectors.selectActiveTraitFilters);

  constructor(
    private store: Store<GlobalState>,
    public dataSvc: DataService,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.selected && !changes.selected.firstChange) {
      this.phunkCheck?.forEach((checkbox) => {
        const hashId = checkbox.nativeElement.dataset.hashId;
        if (!hashId) return;
        checkbox.nativeElement.checked = !!this.selected[hashId];
      });
    }

    if (changes.selectAll) {
      this.phunkCheck?.forEach((checkbox) => {
        checkbox.nativeElement.checked = this.selectAll;

        const hashId = checkbox.nativeElement.dataset.hashId;
        if (!hashId) return;

        const phunk = this.phunkData.find((phunk) => phunk.hashId === hashId);
        if (!phunk) return;
        this.selectPhunk(phunk, true, !this.selectAll);
      });
    }
  }

  selectPhunk(phunk: Phunk, upsert: boolean = false, remove: boolean = false) {
    if (remove) {
      const selected = { ...this.selected };
      delete selected[phunk.hashId];
      this.selected = selected;
      this.selectedChange.emit(this.selected);
      return;
    }

    if (upsert) {
      if (!this.selected[phunk.hashId]) this.selected[phunk.hashId] = phunk;
    } else {
      if (this.selected[phunk.hashId]) {
        const selected = { ...this.selected };
        delete selected[phunk.hashId];
        this.selected = selected;
      } else {
        this.selected[phunk.hashId] = phunk;
      }
    }

    this.selectedChange.emit(this.selected);
  }

  scrollingDown: boolean = false;
  prevIndex: number | null = null;

  onIntersection($event: IntersectionObserverEntry[]): void {
    if (!this.observe) return;
    if (this.limit >= this.phunkData.length) return;

    $event.forEach((entry) => {
      if (entry.isIntersecting) {
        const target = entry.target as HTMLElement;
        const index = Number(target.dataset.index);

        // If prevIndex hasn't been set yet, initialize it
        if (this.prevIndex === null) {
          this.prevIndex = index;
          return;
        }

        if (index > this.limit - PAGE_SIZE) {
          this.limit += PAGE_SIZE;
        }
      }
    });
  }
}
