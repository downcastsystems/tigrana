// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { importPdf } from './importPdf';
const state = vi.hoisted(() => ({ getDocument: vi.fn(), destroy: vi.fn(async () => {}) }));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {}, getDocument: state.getDocument,
  OPS: { save: 1, restore: 2, transform: 3, paintImageXObject: 4, paintInlineImageXObject: 5 },
  Util: {
    transform: (a: number[], b: number[]) => [a[0]*b[0],0,0,a[3]*b[3],a[0]*b[4]+a[4],a[3]*b[5]+a[5]],
    applyTransform: (p: number[], m: number[]) => { p[0] = p[0]*m[0]+m[4]; p[1] = p[1]*m[3]+m[5]; },
  },
}));
afterEach(() => { vi.restoreAllMocks(); });
describe('PDF import', () => {
  it('keeps text, estimated headings, tables, images and scanned pages in one note', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData: () => ({data:new Uint8ClampedArray(4)}) } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback({ size:3, arrayBuffer:async () => new Uint8Array([1,2,3]).buffer } as Blob));
    const item = (str: string, x: number, y: number, height=10) => ({ str, width:20, transform:[1,0,0,height,x,y], fontName:'body' });
    const page = (number: number) => ({
      view:[0,0,200,300], getViewport:() => ({width:200,height:300,scale:1,transform:[1,0,0,1,0,0]}),
      render:() => ({promise:Promise.resolve(),cancel:vi.fn()}),
      commonObjs:{has:()=>true,get:()=>({name:'SampleBold'})},
      getTextContent:async () => ({items:number===2 ? [] : [item('Heading',10,20,20), item('Long ordinary body text with enough characters',10,50),item('A',10,80),item('B',100,80)],styles:{body:{fontFamily:'sans-serif'}}}),
      getOperatorList:async () => ({fnArray:[1,3,4,2],argsArray:[[],[60,0,0,40,10,100],[],[]]}),
      cleanup:vi.fn(),
    });
    state.getDocument.mockReturnValue({promise:Promise.resolve({numPages:2,getPage:async (n:number)=>page(n)}),destroy:state.destroy});
    const progress = vi.fn(async () => {});
    const result = await importPdf(new ArrayBuffer(0), {signal:new AbortController().signal,progress,commit:progress});
    expect(result.html).toContain('<h1><strong>Heading</strong></h1>');
    expect(result.html).toContain('Long ordinary body');
    expect(result.html).toContain('<table>');
    expect(result.assets).toHaveLength(2);
    expect(result.warnings.join(' ')).toContain('Text recognition (OCR) is not included');
    expect(state.destroy).toHaveBeenCalled();
  });
  it('does not open a cancelled PDF import', async () => {
    state.getDocument.mockClear();
    const controller = new AbortController(); controller.abort();
    const progress = vi.fn(async () => {});
    await expect(importPdf(new ArrayBuffer(0), {signal:controller.signal,progress,commit:progress})).rejects.toMatchObject({name:'AbortError'});
    expect(state.getDocument).not.toHaveBeenCalled();
  });
});
