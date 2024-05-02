import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, effect, input, viewChild } from '@angular/core';
import { AsyncPipe, DatePipe, LowerCasePipe } from '@angular/common';

import { LogItem } from '@/services/socket.service';

import { TimeagoModule } from 'ngx-timeago';

@Component({
  standalone: true,
  imports: [
    AsyncPipe,
    LowerCasePipe,
    DatePipe,
    TimeagoModule
  ],
  selector: 'app-logger',
  templateUrl: './logger.component.html',
  styleUrl: './logger.component.scss'
})
export class LoggerComponent implements AfterViewInit {

  logs = input<LogItem[] | null>();

  scroller = viewChild<ElementRef<HTMLDivElement>>('scroller');

  constructor(
    private cdr: ChangeDetectorRef
  ) {
    effect(() => {
      console.log('Logs:', this.logs());
      this.scrollToBottom();
    });
  }

  ngAfterViewInit(): void {
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    if (!this.scroller()?.nativeElement) return;

    setTimeout(() => {
      this.scroller()!.nativeElement.scrollTop = this.scroller()!.nativeElement.scrollHeight;
      this.cdr.detectChanges();
    }, 100);
  }
}
