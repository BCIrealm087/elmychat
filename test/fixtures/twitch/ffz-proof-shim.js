// Our deterministic contract fixture. Not upstream FFZ code or live evidence.
(() => {
  if (globalThis.fixtureReplaceHosts) {
    const nodes = [...document.querySelectorAll('[data-a-target="chat-line-message"]')];
    globalThis.fixtureEnhancedRoots = nodes.map((node,index)=>{
      const host = document.createElement('div');
      host.className='chat-line__message';host.dataset.roomId='fixture-room';
      const name=document.createElement('b');name.textContent=`Enhanced fixture ${index}`;
      const text=document.createElement('span');text.textContent=' Native content in a renderer-owned replacement host';
      host.append(name,text);node.replaceWith(host);return host;
    });
  }
  const saved = []; const writes = [];
  let metadataReady = !globalThis.fixtureMetadataDelay;
  if (!metadataReady && globalThis.fixtureMetadataDelay!=='manual') setTimeout(()=>{metadataReady=true;},250);
  const modules = {};
  const emotes = { emote_sets:{} };
  const manifest = { '7tv-emotes':{requires:[],version:'fixture-7tv'}, 'ffzap-core':{requires:[],version:'fixture-core'},
    'ffzap-bttv':{requires:['ffzap-core'],version:'fixture-bttv'} };
  const manager = { enabled:true, enabled_addons:saved,
    hasAddon:id=>metadataReady && !!manifest[id], getAddon:id=>manager.hasAddon(id)?manifest[id]:null,
    getVersion:id=>{if(!manager.hasAddon(id))throw new Error(`Unknown add-on id: ${id}`);return manifest[id].version;},
    doesAddonTarget:()=>true, isAddonEnabled:id=>{if(!manager.hasAddon(id))throw new Error(`Unknown add-on id: ${id}`);return manager.enabled_addons.includes(id);},
    enableAddon(id,save=true) {
      if (manager.isAddonEnabled(id)) return;
      for(const dependency of manifest[id].requires) manager.enableAddon(dependency);
      manager.enabled_addons.push(id);
      if(save) writes.push(id);
      modules[`addon.${id}`] = {enabled:true};
      if(id==='ffzap-core')return;
      const set = `fixture-${id}`; emotes.emote_sets[set] = {__source:id,emotes:{fixture:{}}};
      if(globalThis.fixtureNoEmotes)return;
      setTimeout(()=>{
        const root = globalThis.fixtureEnhancedRoots?.[0] ?? document.querySelector('[data-id="native-a"]');
        const image = document.createElement('img');
        image.dataset.provider='ffz'; image.dataset.set=set;
        image.alt=`fixture-${id}`; image.style.cssText='width:60px;height:42px;vertical-align:bottom';
        image.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="42"><rect width="60" height="42" fill="blue"/></svg>');
        root.append(image);
      },30);
    },
  };
  const settings = {provider:{get:()=>saved}};
  modules.addons=manager; modules['chat.emotes']=emotes; modules.settings=settings;
  const instance = {resolve:id=>modules[id]};
  globalThis.fixtureFfz = {manager,saved,writes,releaseMetadata:()=>{metadataReady=true;}};
  globalThis.FrankerFaceZ = {get:()=>instance,version_info:{major:0,minor:0,revision:1,build:'fixture'}};
  globalThis.ffz=instance;
})();
