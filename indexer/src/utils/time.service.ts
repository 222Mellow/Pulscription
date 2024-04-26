import { Injectable } from '@nestjs/common';

@Injectable()
export class TimeService {

  private lastProcessedTime: Date | null = null;
  private processingTimes: number[] = [];

  /**
   * Logs the processing time of a block.
   */
  logBlockProcessed() {
    const now = new Date();

    if (this.lastProcessedTime) {
      const currentProcessingTime = now.getTime() - this.lastProcessedTime.getTime();
      this.processingTimes.push(currentProcessingTime);
      if (this.processingTimes.length > 500) this.processingTimes.shift();
    }

    this.lastProcessedTime = now;
  }

  /**
   * Calculates the estimated time remaining based on the current block and total blocks.
   * @param currentBlock The current block number.
   * @param totalBlocks The total number of blocks.
   * @returns A string representing the estimated time remaining.
   */
  getTimeRemainingEstimate(currentBlock: number, totalBlocks: number): string {
    const avgProcessingTime = this.getAverageProcessingTime();
    const blocksRemaining = totalBlocks - currentBlock;
    const timeRemainingInMilliseconds = avgProcessingTime * blocksRemaining;

    return this.millisecondsToHumanReadable(timeRemainingInMilliseconds);
  }

  /**
   * Calculates the average processing time based on the recorded processing times.
   * If there are no recorded processing times, it returns 0.
   *
   * @returns The average processing time.
   */
  private getAverageProcessingTime(): number {
    if (!this.processingTimes.length) return 0;
    return this.processingTimes.reduce((acc, curr) => acc + curr, 0) / this.processingTimes.length;
  }

  /**
   * Converts milliseconds to a human-readable format.
   * @param milliseconds - The number of milliseconds to convert.
   * @returns A string representing the converted time in the format "X days, X hours, X minutes, X seconds".
   */
  private millisecondsToHumanReadable(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    return `${days} days, ${hours % 24} hours, ${minutes % 60} minutes, ${seconds % 60} seconds`;
  }

  howLongAgo(timestamp: string): string {
    const now: Date = new Date();
    const past: Date = new Date(timestamp);
    const differenceInMilliseconds: number = now.getTime() - past.getTime();

    const differenceInSeconds: number = Math.floor(
      differenceInMilliseconds / 1000
    );
    const differenceInMinutes: number = Math.floor(differenceInSeconds / 60);
    const differenceInHours: number = Math.floor(differenceInMinutes / 60);
    const differenceInDays: number = Math.floor(differenceInHours / 24);

    const remainingHours: number = differenceInHours % 24;
    const remainingMinutes: number = differenceInMinutes % 60;
    const remainingSeconds: number = differenceInSeconds % 60;

    let result: string = '';

    if (differenceInDays > 0) {
      result += differenceInDays + 'day ';
    }
    if (remainingHours > 0 || differenceInDays > 0) {
      result += remainingHours + 'hr ';
    }
    if (remainingMinutes > 0 || remainingHours > 0 || differenceInDays > 0) {
      result += remainingMinutes + 'min ';
    }
    if (
      remainingSeconds > 0 ||
      remainingMinutes > 0 ||
      remainingHours > 0 ||
      differenceInDays > 0
    ) {
      result += remainingSeconds + 'sec ';
    }

    return result;
  }
}
