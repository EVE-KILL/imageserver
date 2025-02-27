export default defineEventHandler(async () => {
    return {
        status: 'ok',
        version: '0.1.0',
        name: 'EVE Image Server Proxy (Unofficial)',
        description: 'A proxy server for EVE Online images.',
        officialDocumentation: 'https://developers.eveonline.com/docs/services/image-server/',
        typeImageSource: 'https://newedenencyclopedia.net/thirdpartydev.html',
        usage: {
            '/alliances/{alliance_id}/logo': 'Alliance logo',
            '/alliances/{alliance_id}/logo?size={8,16,32,64,128,256,512,1024,2048}': 'Alliance logo with specific size (If upstream max is 512, and you say 2048, you get 512)',
            '/corporations/{corporation_id}/logo': 'Corporation logo',
            '/corporations/{corporation_id}/logo?size={8,16,32,64,128,256,512,1024,2048}': 'Corporation logo with specific size',
            '/characters/{character_id}/portrait': 'Character portrait',
            '/characters/{character_id}/portrait?size={64,128,256,512}': 'Character portrait with specific size',
            '/types/{type_id}/icon': 'Type icon',
            '/types/{type_id}/icon?size={16,32,64,128,256,512}': 'Type icon with specific size',
            '/types/{type_id}/bp': 'Type blueprint icon',
            '/types/{type_id}/bp?size={16,32,64,128,256,512}': 'Type blueprint icon with specific size',
            '/types/{type_id}/bpc': 'Type blueprint copy icon',
            '/types/{type_id}/bpc?size={16,32,64,128,256,512}': 'Type blueprint copy icon with specific size',
            '/types/{type_id}/render': 'Ship render icon',
            '/types/{type_id}/render?size={16,32,64,128,256,512}': 'Ship render icon with specific size',
            '/status': 'Server status',
        }
    }
});
