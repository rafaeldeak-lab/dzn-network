// Atmospheric renderer adapted from the approved Events motion preview.
export function startEventsAtmosphere(canvas, onFrame) {
  const ctx=canvas.getContext('2d');
  if (!ctx) return () => {};
  const W=1672,H=940,TAU=Math.PI*2,DURATION=28;
  const g=ctx;
  let seed=728491;
  const rand=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const periodic=(t,start)=>((t-start)%DURATION+DURATION)%DURATION;
  function glow(c,x,y,r,color,a,sx=1,sy=1){
    if(a<=0)return;
    c.save();c.translate(x,y);c.scale(sx,sy);
    const grd=c.createRadialGradient(0,0,0,0,0,r);
    grd.addColorStop(0,`rgba(${color},${a})`);grd.addColorStop(.23,`rgba(${color},${a*.55})`);grd.addColorStop(1,`rgba(${color},0)`);
    c.fillStyle=grd;c.fillRect(-r,-r,r*2,r*2);c.restore();
  }
  // A seeded, soft noise texture gives the mist an irregular, cloudlike structure.
  const mist=document.createElement('canvas');mist.width=720;mist.height=190;
  const m=mist.getContext('2d'),pixels=m.createImageData(mist.width,mist.height);
  const grids=[5,11,23,47].map(n=>({n,a:Array.from({length:(n+1)*(n+1)},rand)}));
  const smooth=n=>n*n*(3-2*n);
  function noise(x,y,grid){
    const n=grid.n,xx=x*n,yy=y*n,ix=Math.floor(xx),iy=Math.floor(yy),u=smooth(xx-ix),v=smooth(yy-iy),a=grid.a;
    const q=(i,j)=>a[(Math.min(j,n))*(n+1)+Math.min(i,n)];
    return (q(ix,iy)*(1-u)+q(ix+1,iy)*u)*(1-v)+(q(ix,iy+1)*(1-u)+q(ix+1,iy+1)*u)*v;
  }
  for(let y=0;y<mist.height;y++)for(let x=0;x<mist.width;x++){
    const u=x/(mist.width-1),v=y/(mist.height-1);
    const n=.52*noise(u,v,grids[0])+.27*noise(u,v,grids[1])+.14*noise(u,v,grids[2])+.07*noise(u,v,grids[3]);
    const edge=Math.pow(Math.sin(Math.PI*u),.7)*Math.pow(Math.sin(Math.PI*v),1.7);
    const k=(y*mist.width+x)*4;
    pixels.data[k]=126;pixels.data[k+1]=139;pixels.data[k+2]=179;
    pixels.data[k+3]=Math.round(clamp((n-.22)*1.3)*edge*150);
  }
  m.putImageData(pixels,0,0);
  const fires=[{x:1417,y:510,s:1.3},{x:1215,y:415,s:.8},{x:1320,y:143,s:.5},{x:1275,y:282,s:.45}];
  const sparks=fires.flatMap((fire,j)=>Array.from({length:j<2?14:6},()=>({fire,phase:rand(),dx:rand()*24-12,rise:13+rand()*36,size:.5+rand()*.8,cycles:4+Math.floor(rand()*3)})));

  // Sparse paired shots anchored on the fortress walls, as in the approved preview.
  const shots=[
    {t:1.65,x:1210,y:378,tx:1450,ty:455},
    {t:5,x:1450,y:455,tx:1210,ty:378},
    {t:8.4,x:1258,y:307,tx:1435,ty:405},
    {t:12.15,x:1435,y:405,tx:1258,ty:307},
    {t:16.3,x:1290,y:350,tx:1470,ty:438}
  ];
  function beam(t,x,y,length,base,spread,offset,strength){
    const p=TAU*t/DURATION;
    const a=base+Math.sin(p+offset)*.28+Math.sin(p*2+offset)*.04;
    g.save();g.translate(x,y);g.rotate(a);g.globalCompositeOperation='screen';g.filter='blur(3.5px)';
    const gradient=g.createLinearGradient(0,0,0,length);
    gradient.addColorStop(0,`rgba(130,196,224,${strength*.8})`);
    gradient.addColorStop(.18,`rgba(130,179,220,${strength})`);
    gradient.addColorStop(.82,`rgba(117,148,197,${strength*.42})`);
    gradient.addColorStop(1,'rgba(100,135,190,0)');
    g.fillStyle=gradient;g.beginPath();g.moveTo(-1,0);g.lineTo(-spread,length);g.quadraticCurveTo(0,length+12,spread,length);g.lineTo(1,0);g.closePath();g.fill();
    g.filter='blur(1px)';g.globalAlpha=.28;g.beginPath();g.moveTo(0,0);g.lineTo(-spread*.2,length);g.lineTo(spread*.2,length);g.closePath();g.fill();g.restore();
    glow(g,x,y,9,'120,210,242',.22);
  }
  function draw(t){
    t=((t%DURATION)+DURATION)%DURATION;
    const p=TAU*t/DURATION;
    g.clearRect(0,0,W,H);
    g.save();
    g.globalCompositeOperation='screen';
    // Searchlights pivot around actual lamps in the supplied fortress.
    beam(t,1535,140,430,.48,42,.3,.16);
    beam(t,1377,366,340,.67,32,2.8,.105);
    // Deep fog drifts slowly while nearer wisps travel steadily through the valley.
    g.save();g.filter='blur(2px)';
    g.globalAlpha=.34;g.drawImage(mist,730+82*Math.sin(p),540+15*Math.cos(p),650,220);
    g.globalAlpha=.25;g.drawImage(mist,900+59*Math.cos(p+.6),470+14*Math.sin(p),570,200);
    for(let i=0;i<4;i++){
      const q=(t/14+i*.25)%1,envelope=Math.pow(Math.sin(Math.PI*q),1.4);
      g.globalAlpha=.3*envelope;
      g.drawImage(mist,680+q*640,580+13*Math.sin(q*TAU+i),440,175);
    }
    g.globalAlpha=.13;g.drawImage(mist,1040+42*Math.sin(p*2+2.1),650+8*Math.cos(p*2),460,86);g.restore();
    // Local light breathes against existing fire positions instead of washing over the banner.
    fires.forEach((f,j)=>{
      const flicker=.72+.16*Math.sin(37*p+j*2)+.08*Math.sin(61*p+j)+.04*Math.sin(83*p+j);
      glow(g,f.x,f.y,34*f.s,'255,145,63',.19*flicker,1.25,1);
      glow(g,f.x,f.y-3*f.s,9*f.s,'255,181,79',.40*flicker,.6,1.6);
      glow(g,f.x,f.y-5*f.s,4*f.s,'255,224,151',.58*flicker,.55,1.65);
      g.save();g.globalAlpha=.07;g.drawImage(mist,f.x-52+7*Math.sin(p+j),f.y-62+4*Math.cos(p*2+j),100,60);g.restore();
    });
    sparks.forEach(s=>{
      const q=(t/DURATION*s.cycles+s.phase)%1;
      const fade=Math.pow(Math.sin(Math.PI*q),1.7);
      const x=s.fire.x+s.dx*q+3*Math.sin(q*6+s.phase*TAU),y=s.fire.y-q*s.rise;
      glow(g,x,y,s.size*2,'255,164,87',fade*.30);
      g.strokeStyle=`rgba(255,200,131,${fade*.75})`;g.lineWidth=s.size*.6;
      g.beginPath();g.moveTo(x,y+1.2);g.lineTo(x+.25,y-1.2);g.stroke();
    });
    for(const shot of shots){
      for(const delay of [0,.22]){
        const dt=periodic(t,shot.t+delay);
        if(dt<.17){
          const a=Math.sin(Math.PI*dt/.17);
          glow(g,shot.x,shot.y,15,'255,162,73',a*.55);
          glow(g,shot.x,shot.y,4,'255,231,166',a*.95,1.7,.5);
        }
        if(dt>.025&&dt<.24){
          const q=(dt-.025)/.215,head=clamp(q),tail=clamp(q-.16);
          g.strokeStyle=`rgba(255,195,117,${Math.sin(Math.PI*q)*.66})`;g.lineWidth=.8;
          g.beginPath();
          g.moveTo(shot.x+(shot.tx-shot.x)*tail,shot.y+(shot.ty-shot.y)*tail);
          g.lineTo(shot.x+(shot.tx-shot.x)*head,shot.y+(shot.ty-shot.y)*head);g.stroke();
        }
      }
    }
    g.restore();
  }
  canvas.width=W;canvas.height=H;
  let clock=0,last=performance.now(),lastPaint=0,raf=0,visible=true;
  const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
  function paint(now){
    if(visible&&!document.hidden&&!preference.matches){
      clock+=(now-last)/1000;
      if(now-lastPaint>=1000/30){draw(clock);onFrame(clock,DURATION);lastPaint=now;}
    }
    last=now;
    raf=requestAnimationFrame(paint);
  }
  function motionChanged(){if(preference.matches){ctx.clearRect(0,0,W,H);onFrame(0,DURATION);}}
  const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;last=performance.now();});
  observer.observe(canvas);
  preference.addEventListener('change',motionChanged);
  raf=requestAnimationFrame(paint);
  return ()=>{cancelAnimationFrame(raf);observer.disconnect();preference.removeEventListener('change',motionChanged);};
}
