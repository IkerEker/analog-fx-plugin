// banco de imágenes: node it.js tecnica[,..] variante|all intensidades fotos salida.png [overrides json]
// Fotos de prueba: tools/dev/work/ph/<nombre>.rgba + work/ph/dims.json ({"nombre":[w,h]}). Ver CONTEXTO.md.
const fs=require('fs'),{execFileSync}=require('child_process');
const S=require('path').join(__dirname,'work');
delete require.cache[require.resolve(require('path').join(__dirname,'../../plugin/js/image.js'))];
const IM=require(require('path').join(__dirname,'../../plugin/js/image.js'));
const dims=JSON.parse(fs.readFileSync(S+'/ph/dims.json'));
const [techs,vsel,ints,photos,outName,ov]=process.argv.slice(2);
const TW=Number(process.env.TW||360);const tiles=[];let tot=0;
for(const tid of techs.split(',')){const t=IM.byId(tid);
 for(const v of t.variants){ if(vsel!=='all'&&!vsel.split(',').includes(v.id))continue;
  for(const ph of photos.split(',')){const [w,h]=dims[ph],px=fs.readFileSync(S+'/ph/'+ph+'.rgba');
   for(const I of ints.split(',').map(Number)){
    const p=IM.build(t,v,Number(process.env.PAL||0));p.seed=3;p.intensity=I; if(ov)Object.assign(p,JSON.parse(ov));
    if(IM.applyIntensity) IM.applyIntensity(p,I); else IM.INTENSITY.forEach(k=>{if(typeof p[k]==='number')p[k]=Math.max(0,Math.min(1,p[k]*I));});
    const t0=Date.now(),r=IM.render(px,w,h,4,p);tot+=Date.now()-t0;
    const img=Buffer.alloc(w*h*3),bg=[236,233,224];
    for(let i=0;i<w*h;i++){const a=r.rgba[i*4+3]/255;for(let k=0;k<3;k++){const c=r.rgba[i*4+k];img[i*3+k]=Math.round(r.blend==='multiply'?bg[k]*(1-a+a*c/255):bg[k]*(1-a)+c*a);}}
    const f=`${S}/tiles/${tid}_${v.id}_${ph}_${I}.ppm`;fs.mkdirSync(S+'/tiles',{recursive:true});
    fs.writeFileSync(f,Buffer.concat([Buffer.from(`P6 ${w} ${h} 255\n`),img]));tiles.push(f);}}}}
const cols=Number(process.env.COLS||ints.split(',').length),TH=Math.round(TW*0.72),args=[];tiles.forEach(t=>args.push('-i',t));
const fc=tiles.map((_,i)=>`[${i}]scale=${TW}:${TH}:force_original_aspect_ratio=decrease,pad=${TW}:${TH}:(ow-iw)/2:(oh-ih)/2:color=0xECE9E0[t${i}]`).join(';');
const lay=tiles.map((_,i)=>`${(i%cols)*TW}_${Math.floor(i/cols)*TH}`).join('|');
execFileSync('ffmpeg',['-v','error','-y',...args,'-filter_complex',tiles.length>1?`${fc};${tiles.map((_,i)=>`[t${i}]`).join('')}xstack=inputs=${tiles.length}:layout=${lay}:fill=0xECE9E0`:fc.replace('[t0]',''),S+'/'+outName]);
console.log(outName,tiles.length,'tiles',tot,'ms');
