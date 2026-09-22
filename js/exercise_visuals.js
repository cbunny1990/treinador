"use strict";
// Approved originals: byte-for-byte PNG files, never resized or redrawn.
const VC_APPROVED_VISUALS = Object.freeze([
  {
    "key": "exercise-ativacao-conduzir-passar-dar-opcao",
    "src": "assets/exercises/approved-20260922/01_ativacao_conduzir_passar_dar_opcao.png",
    "width": 1448,
    "height": 1086,
    "bytes": 1754859,
    "sha256": "8a82ac2a8b9f519320160de9b0a4319d1f78b501babbc8f1e6197b8da47f817b"
  },
  {
    "key": "exercise-passar-apoiar-terceiro-homem",
    "src": "assets/exercises/approved-20260922/02_passar_apoiar_terceiro_homem.png",
    "width": 1448,
    "height": 1086,
    "bytes": 1684995,
    "sha256": "b9dcf40f03a6bc7f1ac51874b0880858d7cc99e7908c394e1262174792b08c27"
  },
  {
    "key": "exercise-saida-curta-gr-3-vs-3",
    "src": "assets/exercises/approved-20260922/03_saida_curta_gr_3_vs_3.png",
    "width": 1448,
    "height": 1086,
    "bytes": 1835425,
    "sha256": "ac9a9f0207821ecf3f71e1693aad6d079b769e85c239b2ca858aa52fbe60030f"
  },
  {
    "key": "exercise-jogo-condicionado-sair-acelerar",
    "src": "assets/exercises/approved-20260922/04_jogo_condicionado_sair_acelerar.png",
    "width": 1448,
    "height": 1086,
    "bytes": 1831623,
    "sha256": "12c6706b5fec282f1ce67e7ff1ab1295b689f6ca36a1cb270fe72a6eb80ff72c"
  },
  {
    "key": "exercise-jogo-livre-observar-saida",
    "src": "assets/exercises/approved-20260922/05_jogo_livre_observar_saida.png",
    "width": 1448,
    "height": 1086,
    "bytes": 1868112,
    "sha256": "e3ada7e9e2930906f8f753e9a5104561f837316fcf8ec925655e006400a7dc54"
  }
]);

function vcVisualSafeSource(value){
  const src=String(value||"").trim();
  if(/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(src)) return src;
  if(/^assets\/exercises\/[a-z0-9_./-]+$/i.test(src)&&!src.includes("..")) return src;
  try{const url=new URL(src);if(url.protocol==="https:"&&!url.username&&!url.password) return url.href;}catch(_){}
  return null;
}
function vcVisualSource(exercise){
  if(exercise?.visual_removed) return null;
  const approved=VC_APPROVED_VISUALS.find((x)=>x.key===exercise?.external_key);
  const explicit=vcVisualSafeSource(exercise?.visual_url);
  if(explicit) return {src:explicit,width:exercise?.visual_image?.width||approved?.width,height:exercise?.visual_image?.height||approved?.height};
  // Exact identity, not keywords: stale low-resolution copies must not hide approved originals.
  if(approved) return approved;
  const legacy=vcVisualSafeSource(exercise?.visual_data_url);
  return legacy?{src:legacy}:null;
}
function vcVisualEscape(value){return String(value??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function vcVisualRender(exercise,compact){
  const visual=vcVisualSource(exercise);if(!visual) return "";
  const src=vcVisualEscape(visual.src),title=vcVisualEscape(exercise?.nome||"Exercício");
  const dims=Number.isFinite(visual.width)&&Number.isFinite(visual.height)?' width="'+visual.width+'" height="'+visual.height+'"':"";
  const image='<img data-exercise-original class="'+(compact?'exercise-visual-thumb-img':'exercise-visual-full')+'" src="'+src+'" alt="Imagem do exercício '+title+'" loading="'+(compact?'lazy':'eager')+'" decoding="async"'+dims+'>';
  if(compact) return image;
  return '<figure class="exercise-original-figure"><button type="button" class="exercise-original-open" data-action="exercise-visual-open" aria-label="Ampliar imagem: '+title+'">'+image+'</button><figcaption>Imagem original · <button class="link" type="button" data-action="exercise-visual-open">Ampliar / tamanho original</button></figcaption></figure>';
}
function vcVisualOpen(source,title){
  const src=vcVisualSafeSource(source);if(!src||typeof document==="undefined") return;
  document.getElementById("exercise-image-viewer")?.close();
  const trigger=document.activeElement,dialog=document.createElement("dialog");
  dialog.id="exercise-image-viewer";dialog.className="exercise-image-viewer";
  dialog.setAttribute("aria-labelledby","exercise-image-viewer-title");
  dialog.innerHTML='<header class="image-viewer-toolbar"><strong id="exercise-image-viewer-title"></strong><div class="toolbar"><button class="btn secondary" type="button" data-image-fit>Ajustar</button><button class="btn secondary" type="button" data-image-original>Tamanho original</button><button class="btn accent" type="button" data-image-close autofocus>Fechar</button></div></header><div class="image-viewer-scroll" tabindex="0" aria-label="Imagem ampliada; desliza para ver os detalhes"><img class="image-viewer-image" alt=""></div><p class="image-viewer-help">Toca em Tamanho original e desliza para ler os detalhes.</p>';
  dialog.querySelector("strong").textContent=title||"Imagem do exercício";
  const image=dialog.querySelector("img"),scroll=dialog.querySelector(".image-viewer-scroll");
  image.alt=title||"Imagem do exercício";
  image.addEventListener("error",()=>{dialog.querySelector(".image-viewer-help").textContent="Não foi possível carregar o original. Verifica a ligação e volta a abrir a imagem.";});
  image.src=src;
  const fit=()=>{scroll.classList.remove("original-size");image.style.width="";image.style.height="";scroll.scrollTo(0,0);};
  const original=()=>{if(!image.naturalWidth) return;scroll.classList.add("original-size");image.style.width=image.naturalWidth+"px";image.style.height=image.naturalHeight+"px";scroll.scrollTo(0,0);};
  dialog.querySelector("[data-image-fit]").addEventListener("click",fit);
  dialog.querySelector("[data-image-original]").addEventListener("click",original);
  dialog.querySelector("[data-image-close]").addEventListener("click",()=>dialog.close());
  dialog.addEventListener("close",()=>{dialog.remove();if(trigger?.isConnected) trigger.focus({preventScroll:true});},{once:true});
  document.body.appendChild(dialog);dialog.showModal();
}
if(typeof document!=="undefined") document.addEventListener("click",(event)=>{
  const button=event.target.closest?.('[data-action="exercise-visual-open"]');if(!button) return;
  event.preventDefault();const image=button.closest(".exercise-original-figure")?.querySelector("img");
  if(image) vcVisualOpen(image.getAttribute("src"),image.alt);
});
const VisionExerciseVisuals={approved:VC_APPROVED_VISUALS,source:vcVisualSource,render:vcVisualRender,open:vcVisualOpen,safeSource:vcVisualSafeSource};
if(typeof globalThis!=="undefined") globalThis.VisionExerciseVisuals=VisionExerciseVisuals;
if(typeof module!=="undefined"&&module.exports) module.exports=VisionExerciseVisuals;
