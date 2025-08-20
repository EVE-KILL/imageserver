export default defineEventHandler(async () => {
    return {
        status: 'ok',
        version: '0.1.0',
        name: 'EVE Image Server Proxy (Unofficial)',
        description: 'A proxy server for EVE Online images with caching, resizing, and format conversion.',
        officialDocumentation: 'https://developers.eveonline.com/docs/services/image-server/',
        typeImageSource: 'https://newedenencyclopedia.net/thirdpartydev.html',

        parameters: {
            size: 'Resize image to specific dimensions (varies by endpoint)',
            imagetype: 'Force specific image format (webp, png, jpg). Overrides Accept header.'
        },

        endpoints: {
            alliances: {
                '/alliances/{alliance_id}/logo': 'Alliance logo',
                '/alliances/{alliance_id}/logo?size={8,16,32,64,128,256,512,1024,2048}': 'Alliance logo with specific size',
            },

            corporations: {
                '/corporations/{corporation_id}/logo': 'Corporation logo',
                '/corporations/{corporation_id}/logo?size={8,16,32,64,128,256,512,1024,2048}': 'Corporation logo with specific size',
            },

            characters: {
                '/characters/{character_id}/portrait': 'Character portrait',
                '/characters/{character_id}/portrait?size={64,128,256,512}': 'Character portrait with specific size',
                'note': 'Falls back to old character portraits if current portrait is default/missing'
            },

            oldcharacters: {
                '/oldcharacters/{character_id}': 'Legacy character portrait',
                'note': 'No size parameter available - fixed at 256px'
            },

            types: {
                '/types/{type_id}/icon': 'Type icon',
                '/types/{type_id}/icon?size={16,32,64,128,256,512}': 'Type icon with specific size',
                '/types/{type_id}/bp': 'Type blueprint icon',
                '/types/{type_id}/bpc': 'Type blueprint copy icon',
                '/types/{type_id}/render': 'Ship render icon',
                '/types/{type_id}/overlayrender': 'Ship render icon with overlay (T1-T4, faction, officer, etc.)',
                'note': 'Local images are PNG, upstream images are JPEG. Use imagetype parameter to force format.'
            },

            regions: {
                '/regions/{region_id}': 'Region image',
                '/regions/{region_id}?size={32,64,128}': 'Region image with specific size (closest size will be served)'
            },

            systems: {
                '/systems/{system_id}': 'System image',
                '/systems/{system_id}?size={32,64,128}': 'System image with specific size (closest size will be served)'
            },

            constellations: {
                '/constellations/{constellation_id}': 'Constellation image',
                '/constellations/{constellation_id}?size={32,64,128}': 'Constellation image with specific size (closest size will be served)'
            },

            status: {
                '/status': 'Server cache statistics and folder information'
            }
        }
    }
});
