"use strict";
(function(root){
  const TYPES={
    cone:{name:"Cone",kind:"element"},
    jogador_a:{name:"Equipa A",kind:"element"},
    jogador_b:{name:"Equipa B",kind:"element"},
    bola:{name:"Bola",kind:"element"},
    baliza:{name:"Baliza",kind:"element"},
    mini_baliza:{name:"Mini-baliza",kind:"element"},
    treinador:{name:"Treinador",kind:"element"},
    conducao:{name:"Condução",kind:"arrow"},
    passe:{name:"Passe",kind:"arrow"},
    corrida:{name:"Corrida",kind:"arrow"},
    remate:{name:"Remate",kind:"arrow"},
  };
  const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const clamp=value=>Math.max(0,Math.min(100,value));
  const number=value=>typeof value==="number"&&Number.isFinite(value);
  const arrowStyle={
    conducao:{stroke:"#fde047","stroke-width":2},
    passe:{stroke:"#fff","stroke-width":2,"stroke-dasharray":"6 4"},
    corrida:{stroke:"#fff","stroke-width":1.5,"stroke-dasharray":"2 4"},
    remate:{stroke:"#facc15","stroke-width":3.5},
  };
  function shape(type,x,y,size=1){
    const s=size;
    if(type==="cone")return `<path d="M ${x} ${y-6*s} L ${x+5*s} ${y+4*s} L ${x-5*s} ${y+4*s} Z" fill="#f97316"/>`;
    if(type==="jogador_a")return `<circle cx="${x}" cy="${y}" r="${7*s}" fill="#2563eb"/>`;
    if(type==="jogador_b")return `<circle cx="${x}" cy="${y}" r="${7*s}" fill="#fff" stroke="#dc2626" stroke-width="2"/>`;
    if(type==="bola")return `<circle cx="${x}" cy="${y}" r="${3.5*s}" fill="#fff" stroke="#111827" stroke-width="1"/>`;
    if(type==="baliza")return `<rect x="${x-18*s}" y="${y-3*s}" width="${36*s}" height="${6*s}" fill="#fff" stroke="#111827" stroke-width=".8"/>`;
    if(type==="mini_baliza")return `<rect x="${x-9*s}" y="${y-2.5*s}" width="${18*s}" height="${5*s}" fill="#fff" stroke="#111827" stroke-width=".8"/>`;
    if(type==="treinador")return `<rect x="${x-6*s}" y="${y-6*s}" width="${12*s}" height="${12*s}" fill="#111827"/><text x="${x}" y="${y+3*s}" text-anchor="middle" font-size="${8*s}" fill="#fff">T</text>`;
    return "";
  }
  function render(diagrama,{title="Exercício"}={}){
    if(!diagrama||!Array.isArray(diagrama.elementos))return "";
    const elements=diagrama.elementos.filter(item=>TYPES[item?.tipo]?.kind==="element"&&number(item.x)&&number(item.y));
    if(!elements.length)return "";
    const arrows=(Array.isArray(diagrama.setas)?diagrama.setas:[]).filter(item=>TYPES[item?.tipo]?.kind==="arrow"&&Array.isArray(item.de)&&Array.isArray(item.para)&&item.de.length>=2&&item.para.length>=2&&item.de.slice(0,2).every(number)&&item.para.slice(0,2).every(number));
    const width=number(diagrama.campo?.largura)&&diagrama.campo.largura>0?diagrama.campo.largura:20;
    const length=number(diagrama.campo?.comprimento)&&diagrama.campo.comprimento>0?diagrama.campo.comprimento:30;
    const fieldHeight=Math.max(200,Math.min(480,320*length/width));
    const xPos=value=>10+clamp(value)*3.2;
    const yPos=value=>10+clamp(value)*fieldHeight/100;
    const present=new Set(elements.map(item=>item.tipo));
    arrows.forEach(item=>present.add(item.tipo));
    const used=Object.keys(TYPES).filter(type=>present.has(type));
    const numbered=arrows.some(item=>Number.isInteger(item.passo)&&item.passo>0);
    if(numbered)used.push("step");
    const columns=3,rows=Math.ceil(used.length/columns),rowHeight=19,fieldBottom=fieldHeight+10;
    const legendTop=fieldBottom+19,svgHeight=legendTop+rows*rowHeight+5;
    const legend=used.map((type,index)=>{
      const col=index%columns,row=Math.floor(index/columns),x=14+col*108,y=legendTop+row*rowHeight;
      const symbol=type==="step"
        ?`<circle cx="${x+8}" cy="${y-4}" r="7" fill="#fff" stroke="#111827"/><text x="${x+8}" y="${y-1}" text-anchor="middle" font-size="8" fill="#111827">1</text>`
        :TYPES[type].kind==="element"
          ?shape(type,x+7,y-3,.72)
          :`<path d="M ${x} ${y-3} L ${x+17} ${y-3}" fill="none" ${Object.entries(arrowStyle[type]).map(([k,v])=>`${k}="${v}"`).join(" ")} marker-end="url(#learning-arrow)"/>`;
      const name=type==="step"?"N.º = passo a passo":TYPES[type].name;
      return `<g data-legend="${type}">${symbol}<text x="${x+22}" y="${y}" font-size="11" fill="#111827">${name}</text></g>`;
    }).join("");
    const field=elements.map(item=>{
      const x=xPos(item.x),y=yPos(item.y),label=item.rotulo==null?"":`<text x="${x+8}" y="${y-8}" font-size="10" fill="#fff" stroke="#14532d" stroke-width=".5" paint-order="stroke">${esc(item.rotulo)}</text>`;
      return `<g data-el="${item.tipo}">${shape(item.tipo,x,y)}${label}</g>`;
    }).join("");
    const paths=arrows.map(item=>{
      const x1=xPos(item.de[0]),y1=yPos(item.de[1]),x2=xPos(item.para[0]),y2=yPos(item.para[1]);
      const style=Object.entries(arrowStyle[item.tipo]).map(([k,v])=>`${k}="${v}"`).join(" ");
      const step=Number.isInteger(item.passo)&&item.passo>0?`<g data-step="${item.passo}"><circle cx="${(x1+x2)/2}" cy="${(y1+y2)/2}" r="8" fill="#fff"/><text x="${(x1+x2)/2}" y="${(y1+y2)/2+3}" text-anchor="middle" font-size="10" fill="#111827">${item.passo}</text></g>`:"";
      return `<g><path data-arrow="${item.tipo}" d="M ${x1} ${y1} L ${x2} ${y2}" fill="none" ${style} marker-end="url(#learning-arrow)"/>${step}</g>`;
    }).join("");
    const cones=elements.filter(item=>item.tipo==="cone").length,players=elements.filter(item=>item.tipo==="jogador_a"||item.tipo==="jogador_b").length;
    const aria=`${String(title)}: ${cones} cones, ${players} jogadores, ${arrows.length} setas`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 ${svgHeight}" role="img" aria-label="${esc(aria)}"><defs><marker id="learning-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z" fill="context-stroke"/></marker></defs><rect x="10" y="10" width="320" height="${fieldHeight}" rx="3" fill="#3f9b4a"/><rect x="12" y="12" width="316" height="${fieldHeight-4}" fill="none" stroke="#fff" stroke-width="2"/>${paths}${field}<g>${legend}</g></svg>`;
  }
  const api={render,TYPES};root.LearningDiagram=api;if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(globalThis);
