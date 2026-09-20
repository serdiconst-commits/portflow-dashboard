import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { prepareDocumentImage } from '../services/documentImage.js';

test('document conversion preserves full page proportions and colored marks without enlarging', async () => {
  const source=await sharp({create:{width:1200,height:800,channels:3,background:'#ffffff'}})
    .composite([{input:Buffer.from('<svg width="1200" height="800"><path d="M0 400 L1199 400" stroke="blue" stroke-width="8"/></svg>')}]).png().toBuffer();
  const output=await prepareDocumentImage(source);
  const meta=await sharp(output).metadata();
  assert.equal(meta.width,1200);assert.equal(meta.height,800);
  const {data,info}=await sharp(output).raw().toBuffer({resolveWithObject:true});
  const at=(400*info.width+600)*info.channels;
  assert.ok(data[at+2]>data[at]+100,'blue signature remains colored');
});
test('large portrait and landscape pages retain detail within a bounded resolution',async()=>{
 for(const [width,height] of [[3600,4800],[4800,3600]]){
  const source=await sharp({create:{width,height,channels:3,background:'#ffffff'}}).png().toBuffer();
  const meta=await sharp(await prepareDocumentImage(source)).metadata();
  assert.equal(Math.max(meta.width,meta.height),3300);
  assert.equal(meta.width/meta.height,width/height);
 }
});
