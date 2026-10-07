import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
const base='http://127.0.0.1:3101';
test('accounts, ownership, menu publication, QR and sessions',async()=>{
  const testRoot=path.resolve('test-data');mkdirSync(testRoot,{recursive:true});
  const data=mkdtempSync(path.join(testRoot,'run-'));
  const server=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'3101',DATA_DIR:data},stdio:'pipe'});
  let logs='';server.stderr.on('data',d=>logs+=d);
  try{
    let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}
    assert.ok(ready,'Server starts: '+logs);
    async function request(url,method='GET',body,cookie='',origin){const r=await fetch(base+'/api'+url,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{})},body:body===undefined?undefined:JSON.stringify(body)});const type=r.headers.get('content-type');return {status:r.status,cookie:r.headers.get('set-cookie')?.split(';')[0],data:type?.includes('json')?await r.json():new Uint8Array(await r.arrayBuffer()),headers:r.headers};}
    assert.equal((await request('/me')).status,401);
    assert.equal((await request('/register','POST',{email:'bad',password:'short'})).status,400);
    const a=await request('/register','POST',{email:'first@example.test',password:'a-test-password-123'});assert.equal(a.status,200);assert.ok(a.cookie);
    const b=await request('/register','POST',{email:'second@example.test',password:'a-test-password-456'});assert.equal(b.status,200);
    const space={name:'Espaço de Teste',slug:'espaco-teste',whatsapp:'244923456789',description:'Sabores',address:'Luanda',hours:'12–22h',published:false};
    assert.equal((await request('/space','PUT',{...space,whatsapp:'123'},a.cookie)).status,400);
    assert.equal((await request('/space','PUT',space,a.cookie,'https://evil.test')).status,403);
    assert.equal((await request('/space','PUT',space,a.cookie)).status,200);
    assert.equal((await request('/menu/espaco-teste')).status,404);
    assert.equal((await request('/space','PUT',space,b.cookie)).status,409);
    assert.equal((await request('/space','PUT',{...space,slug:'segundo'},b.cookie)).status,200);
    const product={name:'Prato de teste',category:'Pratos',price:5000,description:'Fresco',image:'javascript:alert(1)',available:true};
    assert.equal((await request('/products','POST',{...product,price:-1},a.cookie)).status,400);
    assert.equal((await request('/products','POST',product,a.cookie)).status,200);
    const owner=await request('/me','GET',undefined,a.cookie);const id=owner.data.products[0].id;
    assert.equal(owner.data.products[0].image,'');
    assert.equal((await request('/products','POST',{...product,id,name:'Alteração indevida'},b.cookie)).status,404);
    assert.equal((await request('/products/'+id,'DELETE',undefined,b.cookie)).status,404);
    assert.equal((await request('/space','PUT',{...space,published:true},a.cookie)).status,200);
    const publicMenu=await request('/menu/espaco-teste');assert.equal(publicMenu.status,200);assert.equal(publicMenu.data.products[0].name,product.name);assert.equal(publicMenu.data.space.owner,undefined);
    const qr=await request('/qr/espaco-teste');assert.equal(qr.status,200);assert.deepEqual([...qr.data.slice(0,8)],[137,80,78,71,13,10,26,10]);
    assert.equal((await request('/space','PUT',{...space,published:false},a.cookie)).status,200);
    assert.equal((await request('/menu/espaco-teste')).status,404);assert.equal((await request('/qr/espaco-teste')).status,404);
    assert.equal((await request('/logout','POST',{},a.cookie)).status,200);assert.equal((await request('/me','GET',undefined,a.cookie)).status,401);
    assert.equal((await request('/login','POST',{email:'first@example.test',password:'wrong'})).status,401);
    assert.equal((await request('/login','POST',{email:'first@example.test',password:'a-test-password-123'})).status,200);
    const page=await fetch(base+'/demo');assert.equal(page.status,200);assert.ok(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  }finally{server.kill();await new Promise(resolve=>server.once('exit',resolve));assert.ok(data.startsWith(testRoot+path.sep));rmSync(data,{recursive:true,force:true});}
});
