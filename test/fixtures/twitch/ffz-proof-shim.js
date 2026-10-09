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
  const saved = globalThis.fixtureStoredSettings?.['addons.enabled'] ?? []; const writes = [];
  const defaults = {
    'chat.rich.enabled': true, 'chat.subs.native': false,
    'chat.badges.custom-mod': true, 'chat.badges.custom-vip': true,
    'chat.badges.unify-bot-badge': 2, 'chat.badges.fix-colors': true, 'chat.badges.hidden': {},
    'chat.font-size': 14, 'chat.font-family': '', 'chat.lines.padding': false, 'chat.lines.borders': 0,
    'addon.seventv_emotes.nametag_paints': true, 'addon.seventv_emotes.nametag_paints_drop_shadows': true,
    'addon.seventv_emotes.badges': true, 'addon.seventv_emotes.animated_avatars': true,
    'ffzap.betterttv.pro_badges': true, 'ffzap.betterttv.update_messages': true,
  };
  const shared = new Map(Object.entries({ 'addons.enabled': saved, ...globalThis.fixtureStoredSettings }));
  const settings = { enabled:true, definitions:new Map(Object.entries(defaults).map(([key,value])=>[key,{default:value}])),
    provider:{get:(key,fallback)=>shared.has(key)?shared.get(key):fallback},
    get(key) { return settings.provider.get(`p:0:${key}`, defaults[key]); },
  };
  class Provider { emit() {} awaitReady() { return Promise.resolve(); } }
  let Isolated;
  if (!globalThis.fixtureIgnoreIsolation) for (const register of globalThis.ffz_providers ?? []) register({
    settings, Provider, registerProvider:(key, Class)=>{if(key==='elmychat-session')Isolated=Class;},
  });
  if (Isolated) {
    settings.provider = new Isolated(settings);
    // Model FFZ's automatic settings-menu bookkeeping before add-ons load.
    // The real engine's initial cfg-seen list is larger than an ordinary value.
    settings.provider.set('cfg-seen', Array.from({length:500}, (_,i)=>`chat.fixture.setting-${i}.appearance`));
    settings.provider.set('cfg-collapsed', ['chat.appearance', 'add-ons']);
  }
  // Model reviewed appearance settings, not upstream rendering internals.
  if (settings.get('chat.font-size') !== 14) document.querySelector('.scroll').style.fontSize=`${settings.get('chat.font-size')}px`;
  let metadataReady = !globalThis.fixtureMetadataDelay;
  if (!metadataReady && globalThis.fixtureMetadataDelay!=='manual') setTimeout(()=>{metadataReady=true;},250);
  const modules = {};
  const emotes = { emote_sets:{} };
  const manifest = { '7tv-emotes':{requires:[],version:'fixture-7tv'}, 'ffzap-core':{requires:[],version:'fixture-core'},
    'ffzap-bttv':{requires:['ffzap-core'],version:'fixture-bttv'} };
  const manager = { enabled:true, enabled_addons:settings.provider.get('addons.enabled', []),
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
        if (id==='7tv-emotes' && settings.get('addon.seventv_emotes.nametag_paints')) root.querySelector('b').dataset.fixturePaint='true';
        if (id==='7tv-emotes' && settings.get('addon.seventv_emotes.badges') || id==='ffzap-bttv' && settings.get('ffzap.betterttv.pro_badges')) {
          const cosmetic=document.createElement('span');cosmetic.dataset.fixtureCosmetic='true';cosmetic.textContent='Extra provider badge';root.append(cosmetic);
        }
      },30);
    },
  };
  modules.addons=manager; modules['chat.emotes']=emotes; modules.settings=settings;
  const instance = {resolve:id=>modules[id]};
  globalThis.fixtureFfz = {manager,saved,writes,emotes,modules,settings,shared,releaseMetadata:()=>{metadataReady=true;}};
  globalThis.FrankerFaceZ = {get:()=>instance,version_info:{major:0,minor:0,revision:1,build:'fixture'}};
  globalThis.ffz=instance;
})();
