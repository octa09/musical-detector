// Reconocimiento de la letra (Whisper) fuera de la pantalla, para que la app no se congele
import {pipeline,env} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';
env.allowLocalModels=false;
let asr=null;
onmessage=async e=>{
  const {x,lang}=e.data;
  try{
    if(!asr){postMessage({type:'msg',text:'Cargando el reconocedor de letra…'});const files={};let last=-1;
      asr=await pipeline('automatic-speech-recognition','Xenova/whisper-base',{dtype:'q8',device:'wasm',progress_callback:p=>{
        if(p.status==='progress'&&p.total){files[p.file]=[p.loaded,p.total];let l=0,t=0;for(const k in files){l+=files[k][0];t+=files[k][1]}
          const pct=Math.round(l/t*100);if(pct!==last){last=pct;postMessage({type:'msg',text:`Descargando el reconocedor de letra (solo la primera vez)… ${pct}% · ${(t/1e6).toFixed(0)} MB`})}}}})}
    postMessage({type:'msg',text:'Escuchando la letra… (puede tardar un poco)'});
    const out=await asr(x,{chunk_length_s:30,stride_length_s:5,return_timestamps:true,task:'transcribe',...(lang?{language:lang}:{})});
    postMessage({type:'done',chunks:(out.chunks||[]).map(c=>({timestamp:c.timestamp,text:c.text}))});
  }catch(err){postMessage({type:'error',message:err&&err.message||String(err)})}
};
