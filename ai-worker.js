// Trabajo pesado fuera de la pantalla: IA para separar la voz y limpieza espectral.
// Corre en un "worker" para que la app siga respondiendo mientras procesa.
// Separación espectral: quita lo que está al centro y es tonal (la voz); deja batería, bajo y lo que va a los lados
function makeFFT(N){const lev=Math.log2(N),rev=new Uint32Array(N),cs=new Float64Array(N/2),sn=new Float64Array(N/2);
  for(let i=0;i<N;i++){let r=0;for(let b=0;b<lev;b++)r|=((i>>b)&1)<<(lev-1-b);rev[i]=r}
  for(let i=0;i<N/2;i++){cs[i]=Math.cos(2*Math.PI*i/N);sn[i]=Math.sin(2*Math.PI*i/N)}
  return (re,im,inv)=>{
    for(let i=0;i<N;i++){const j=rev[i];if(j>i){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t}}
    for(let size=2;size<=N;size<<=1){const h=size>>1,step=N/size;
      for(let i=0;i<N;i+=size)for(let j=0,k=0;j<h;j++,k+=step){const a=i+j,b=a+h,c=cs[k],s=inv?sn[k]:-sn[k],tr=re[b]*c-im[b]*s,ti=re[b]*s+im[b]*c;re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti}}
    if(inv)for(let i=0;i<N;i++){re[i]/=N;im[i]/=N}}}
const med=(a,n)=>{for(let i=1;i<n;i++){const v=a[i];let j=i-1;while(j>=0&&a[j]>v){a[j+1]=a[j];j--}a[j+1]=v}return a[n>>1]};
async function separateSpec(Lx,Rx,sr,amount,onProg){
  const N=4096,H=1024,K=N/2+1,T=9,D=4,F=4,fft=makeFFT(N),len=Lx.length;
  const win=new Float64Array(N);for(let i=0;i<N;i++)win[i]=Math.sqrt(0.5-0.5*Math.cos(2*Math.PI*i/N));
  const oL=new Float32Array(len),oR=new Float32Array(len);
  const ring=[];for(let t=0;t<T;t++)ring.push({lr:new Float64Array(K),li:new Float64Array(K),rr:new Float64Array(K),ri:new Float64Array(K),cm:new Float64Array(K),c:new Float64Array(K),pos:0});
  const fw=new Float64Array(K);for(let k=0;k<K;k++){const f=k*sr/N;fw[k]=f<90?0:f<160?(f-90)/70:f<9000?1:f<14000?1-(f-9000)/5000:0}
  const th=0.9-0.32*amount,strength=Math.min(1,0.45+amount*0.75),hpow=amount>0.9?0.5:1;
  const re=new Float64Array(N),im=new Float64Array(N),tt=new Float64Array(T),tf=new Float64Array(2*F+1);
  const frames=Math.ceil((len+N-H)/H)+D;
  for(let f=0;f<frames;f++){
    const slot=ring[f%T],start=f*H-(N-H);slot.pos=start;
    for(let i=0;i<N;i++){const p=start+i;if(p>=0&&p<len){re[i]=Lx[p]*win[i];im[i]=Rx[p]*win[i]}else{re[i]=0;im[i]=0}}
    fft(re,im,false);
    for(let k=0;k<K;k++){const nk=(N-k)%N,zr=re[k],zi=im[k],wr=re[nk],wi=-im[nk];
      const lr=(zr+wr)/2,li=(zi+wi)/2,rr=(zi-wi)/2,ri=-(zr-wr)/2;
      slot.lr[k]=lr;slot.li[k]=li;slot.rr[k]=rr;slot.ri[k]=ri;
      const pl=lr*lr+li*li,pr=rr*rr+ri*ri,psi=2*(lr*rr+li*ri)/(pl+pr+1e-20);
      const c=Math.max(0,Math.min(1,(psi-th)/(1-th)));slot.c[k]=c;
      const mr=(lr+rr)/2,mi=(li+ri)/2;slot.cm[k]=Math.sqrt(mr*mr+mi*mi)*c}
    const g=f-D;if(g<0)continue;const cur=ring[g%T];
    for(let k=0;k<K;k++){
      let rem=0;
      if(fw[k]>0&&cur.c[k]>0){
        for(let t=0;t<T;t++)tt[t]=ring[t].cm[k];const mt=med(tt,T);
        let n=0;for(let q=k-F;q<=k+F;q++)if(q>=0&&q<K)tf[n++]=cur.cm[q];const mf=med(tf,n);
        let hm=mt*mt/(mt*mt+mf*mf+1e-20);if(hpow!==1)hm=Math.pow(hm,hpow);
        rem=strength*cur.c[k]*hm*fw[k];
      }
      const gk=1-rem,lr=cur.lr[k]*gk,li=cur.li[k]*gk,rr=cur.rr[k]*gk,ri=cur.ri[k]*gk;
      re[k]=lr-ri;im[k]=li+rr;
      if(k>0&&k<N/2){re[N-k]=lr+ri;im[N-k]=rr-li}
    }
    fft(re,im,true);
    const p0=cur.pos;for(let i=0;i<N;i++){const p=p0+i;if(p>=0&&p<len){oL[p]+=re[i]*win[i]*0.5;oR[p]+=im[i]*win[i]*0.5}}
    if(onProg&&g%48===0)onProg(g/(frames-D));
  }
  return [oL,oR];
}
function makeDFT(N){
  let M=1;while(M<2*N-1)M<<=1;const fft=makeFFT(M),cr=new Float64Array(N),ci=new Float64Array(N);
  for(let n=0;n<N;n++){const a=Math.PI*((n*n)%(2*N))/N;cr[n]=Math.cos(a);ci[n]=-Math.sin(a)}
  const br=new Float64Array(M),bi=new Float64Array(M);
  for(let n=0;n<N;n++){br[n]=cr[n];bi[n]=-ci[n];if(n){br[M-n]=cr[n];bi[M-n]=-ci[n]}}
  fft(br,bi,false);const ar=new Float64Array(M),ai=new Float64Array(M);
  return (xr,xi,oR,oI)=>{ar.fill(0);ai.fill(0);
    for(let n=0;n<N;n++){ar[n]=xr[n]*cr[n]-xi[n]*ci[n];ai[n]=xr[n]*ci[n]+xi[n]*cr[n]}
    fft(ar,ai,false);
    for(let k=0;k<M;k++){const r=ar[k]*br[k]-ai[k]*bi[k],i=ar[k]*bi[k]+ai[k]*br[k];ar[k]=r;ai[k]=i}
    fft(ar,ai,true);
    for(let k=0;k<N;k++){oR[k]=ar[k]*cr[k]-ai[k]*ci[k];oI[k]=ar[k]*ci[k]+ai[k]*cr[k]}}}
const AI={nfft:7680,hop:1024,dimF:3072,dimT:256,comp:1.009,sr:44100};
// Separa con el modelo: L,R a 44.1 kHz → voz (L,R). run(Float32Array[1,4,dimF,dimT]) → Float32Array
async function mdxVocals(L,R,run,msg){
  const n=L.length,{nfft,hop,dimF,dimT}=AI,CH=hop*(dimT-1),trim=nfft/2,gen=CH-2*trim,pad=gen-n%gen,chunks=(n+pad)/gen;
  const mL=new Float32Array(trim+n+pad+trim),mR=new Float32Array(mL.length);mL.set(L,trim);mR.set(R,trim);
  const vL=new Float32Array(n+pad),vR=new Float32Array(n+pad),dft=makeDFT(nfft),win=new Float64Array(nfft);
  for(let i=0;i<nfft;i++)win[i]=0.5-0.5*Math.cos(2*Math.PI*i/nfft);
  const xr=new Float64Array(nfft),xi=new Float64Array(nfft),Zr=new Float64Array(nfft),Zi=new Float64Array(nfft),inp=new Float32Array(4*dimF*dimT);
  const wsum=new Float64Array(CH+nfft);for(let t=0;t<dimT;t++)for(let i=0;i<nfft;i++)wsum[t*hop+i]+=win[i]*win[i];
  const ix=(c,k,t)=>(c*dimF+k)*dimT+t,yieldUI=()=>new Promise(r=>setTimeout(r));
  for(let c=0;c<chunks;c++){
    const off=c*gen,get=(a,j)=>{if(j<0)j=-j;else if(j>=CH)j=2*(CH-1)-j;return a[off+j]};
    msg(c,chunks,'stft');
    for(let t=0;t<dimT;t++){
      for(let i=0;i<nfft;i++){const j=t*hop+i-trim;xr[i]=get(mL,j)*win[i];xi[i]=get(mR,j)*win[i]}
      dft(xr,xi,Zr,Zi);
      for(let k=0;k<dimF;k++){const nk=(nfft-k)%nfft,ar=Zr[k],ai=Zi[k],br=Zr[nk],bi=-Zi[nk];
        inp[ix(0,k,t)]=(ar+br)/2;inp[ix(1,k,t)]=(ai+bi)/2;inp[ix(2,k,t)]=(ai-bi)/2;inp[ix(3,k,t)]=-(ar-br)/2}
      
    }
    msg(c,chunks,'ia');
    const out=await run(inp);
    msg(c,chunks,'istft');
    const ol=new Float64Array(CH+nfft),orr=new Float64Array(CH+nfft);
    for(let t=0;t<dimT;t++){
      Zr.fill(0);Zi.fill(0);
      for(let k=0;k<dimF;k++){const lr=out[ix(0,k,t)],li=out[ix(1,k,t)],rr=out[ix(2,k,t)],ri=out[ix(3,k,t)];
        Zr[k]=lr-ri;Zi[k]=-(li+rr);if(k>0){Zr[nfft-k]=lr+ri;Zi[nfft-k]=-(rr-li)}}
      dft(Zr,Zi,xr,xi);
      for(let i=0;i<nfft;i++){const w=win[i]/nfft;ol[t*hop+i]+=xr[i]*w;orr[t*hop+i]-=xi[i]*w}
      
    }
    for(let i=trim;i<CH-trim;i++){const j=i+trim,w=wsum[j]>1e-8?wsum[j]:1;vL[off+i-trim]=ol[j]/w*AI.comp;vR[off+i-trim]=orr[j]/w*AI.comp}
  }
  return [vL.subarray(0,n),vR.subarray(0,n)];
}

const ORT='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
const MODEL_URLS=['https://huggingface.co/huangjackson/Kim_Vocal_2/resolve/main/Kim_Vocal_2.onnx','https://huggingface.co/memoavatar/memo/resolve/main/misc/vocal_separator/Kim_Vocal_2.onnx'];
let sess=null,gpu=false;
const say=text=>postMessage({type:'msg',text});
async function modelBytes(){
  let cache=null;try{cache=await caches.open('notas-modelo')}catch(e){}
  if(cache){const hit=await cache.match('kim-vocal-2');if(hit){say('Cargando el modelo guardado…');return new Uint8Array(await hit.arrayBuffer())}}
  let last;
  for(const u of MODEL_URLS){
    try{const r=await fetch(u);if(!r.ok)throw new Error('HTTP '+r.status);
      const total=+r.headers.get('content-length')||66759214,rd=r.body.getReader(),parts=[];let got=0,lastPct=-1;
      for(;;){const {done,value}=await rd.read();if(done)break;parts.push(value);got+=value.length;const pct=Math.min(100,Math.round(got/total*100));
        if(pct!==lastPct){lastPct=pct;say(`Descargando el modelo de IA (solo la primera vez)… ${pct}% · ${(got/1e6).toFixed(0)} de ${(total/1e6).toFixed(0)} MB`)}}
      const out=new Uint8Array(got);let o=0;for(const p of parts){out.set(p,o);o+=p.length}
      if(cache)try{await cache.put('kim-vocal-2',new Response(out))}catch(e){}
      return out}
    catch(e){last=e}
  }
  throw last||new Error('No se pudo descargar el modelo');
}
async function session(){
  if(sess)return sess;
  if(!self.ort){say('Cargando el motor de IA…');importScripts(ORT+'ort.webgpu.min.js')}
  ort.env.wasm.wasmPaths=ORT;ort.env.wasm.numThreads=self.crossOriginIsolated?Math.min(4,navigator.hardwareConcurrency||1):1;
  const bytes=await modelBytes();say('Preparando el modelo de IA…');
  if(self.navigator&&navigator.gpu){try{sess=await ort.InferenceSession.create(bytes,{executionProviders:['webgpu']});gpu=true;return sess}catch(e){}}
  sess=await ort.InferenceSession.create(bytes,{executionProviders:['wasm'],graphOptimizationLevel:'all'});gpu=false;return sess;
}
async function run(x){
  const go=async s=>{const f={};f[s.inputNames[0]]=new ort.Tensor('float32',x,[1,4,AI.dimF,AI.dimT]);const r=await s.run(f);return r[s.outputNames[0]].data};
  try{return await go(sess)}
  catch(e){if(!gpu)throw e;sess=await ort.InferenceSession.create(await modelBytes(),{executionProviders:['wasm']});gpu=false;return go(sess)}
}
onmessage=async e=>{
  const d=e.data;
  try{
    if(d.type==='sep'){
      await session();const t0=Date.now();
      const [vL,vR]=await mdxVocals(d.L,d.R,run,(c,n)=>{const el=(Date.now()-t0)/1000,eta=c?Math.round(el/c*(n-c)):null;
        say(`Quitando la voz con IA… parte ${c+1} de ${n}`+(eta!=null?` · faltan ~${eta>90?Math.round(eta/60)+' min':eta+' s'}`:' · calculando tiempo…'))});
      const a=vL.slice(),b=vR.slice();postMessage({type:'done',vL:a,vR:b},[a.buffer,b.buffer]);
    }else if(d.type==='spec'){
      const [oL,oR]=await separateSpec(d.L,d.R,d.sr,d.amount,p=>say((d.label||'Quitando la voz…')+' '+Math.round(p*100)+'%'));
      postMessage({type:'done',oL,oR},[oL.buffer,oR.buffer]);
    }
  }catch(err){postMessage({type:'error',message:err&&err.message||String(err)})}
};
