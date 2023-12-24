import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

import { Web3Service } from '@/services/web3.service';

import { HttpClient } from '@angular/common/http';

import { environment } from 'src/environments/environment';

import svgson, { INode } from 'svgson';
import tinycolor from 'tinycolor2';

import { catchError, firstValueFrom, from, map, of, switchMap, tap } from 'rxjs';
import { hexToString } from 'viem';

@Component({
  selector: 'app-phunk-image',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './phunk-image.component.html',
  styleUrls: ['./phunk-image.component.scss']
})
export class PhunkImageComponent implements OnChanges {

  @Input() hashId!: string;
  @Input() tokenId!: number;
  @Input() color: boolean = true;

  phunkImgSrc!: string | null;

  constructor(
    private http: HttpClient,
    private web3Svc: Web3Service,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (this.hashId) this.getPhunkByHashId(this.hashId);
    else if (this.tokenId || this.tokenId === 0) this.getPhunkByTokenId(this.tokenId);
  }

  async getPhunkByTokenId(tokenId: number): Promise<any> {
    const url = `${environment.staticUrl}/images/ethereum-phunks_${tokenId}.svg`;

    const svg = await firstValueFrom(
      this.http.get(url, { responseType: 'text' }).pipe(
        // tap(data => console.log(data)),
        switchMap(data => from(svgson.parse(data))),
        map(data => this.color ? data : this.stripColors(data)),
        map(data => this.convertToBase64(data)),
        catchError((err) => {
          console.error(err);
          return of(null);
        })
      )
    );

    this.phunkImgSrc = svg;
  }

  async getPhunkByHashId(hashId: string): Promise<any> {
    const tx = await this.web3Svc.getTransaction(hashId);
    this.phunkImgSrc = hexToString(tx.input);
  }

  stripColors(node: INode): INode {
    for (const child of node.children) {
      if (child.name === 'rect' && child.attributes?.fill) {
        const color = tinycolor(child.attributes.fill);
        const alpha = tinycolor(color).getBrightness() / 255;
        const opaque = tinycolor({ r: 0, g: 0, b: 0, a: 1 - alpha });

        const filter = [
          '#ffffffff', // White
          '#ead9d9ff', // Albino Skin Tone
          '#dbb180ff', // Light Skin Tone
          '#ae8b61ff', // Mid Skin Tone
          '#713f1dff', // Dark Skin Tone
          '#7da269ff', // Zombie Skin Tone
          '#352410ff', // Ape Skin Tone
          '#c8fbfbff', // Alien Skin Tone
        ];

        // Remove Skin Tone
        if (filter.indexOf(child.attributes.fill) > -1) child.attributes.fill = '#00000000';
        // Remove Transparent
        else if (child.attributes.fill === '#000000ff') continue;
        else child.attributes.fill = opaque.toString('hex8');
      }
    }
    return node;
  }

  convertToBase64(node: INode): string {
    const string = svgson.stringify(node);
    const decoded = unescape(encodeURIComponent(string));
    const base64 = btoa(decoded);
    return `data:image/svg+xml;base64,${base64}`;
  }

  getRandomNumbers(): string[] {
    const numbers: Set<string> = new Set();
    while (numbers.size < 7) {
      const random = Math.floor(Math.random() * 10000);
      const formatted = String(random).padStart(4, '0');
      numbers.add(formatted);
    }
    return [...numbers];
  }

  formatNumber(num: string): string | null {
    if (!num) return null;
    return String(num).padStart(4, '0');
  }
}
