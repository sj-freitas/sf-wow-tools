// A small snapshot of Wowhead's pages, as the browser snippet saves them (scripts/database/
// snippet.mjs): Blacksmithing's and Enchanting's spells and recipe items, written the way Wowhead
// writes them (mostly JSON, some keys unquoted). The database test builds Data.fixture.lua from it,
// which the addon's specs load: `UPDATE_FIXTURES=1 npm test` rewrites that file after a change to
// the format.

const blacksmithingSpells = `//<![CDATA[
WH.Gatherer.addData(3, 16, {"2862":{"name_enus":"Rough Sharpening Stone","quality":1,"icon":"inv_stone_sharpeningstone_01","jsonequip":{"sellprice":2}},"2835":{"name_enus":"Rough Stone","quality":1,"icon":"inv_stone_04","jsonequip":{"sellprice":1}},"2852":{"name_enus":"Copper Chain Pants","quality":2,"icon":"inv_pants_03","jsonequip":{"armor":94,"dura":50,"reqlevel":4,"sellprice":67,"slotbak":7,"sta":1}},"2840":{"name_enus":"Copper Bar","quality":1,"icon":"inv_ingot_02","jsonequip":{"sellprice":10}},"2864":{"name_enus":"Runed Copper Breastplate","quality":2,"icon":"inv_chest_plate05","jsonequip":{"armor":160,"reqlevel":13,"slotbak":5,"str":3,"spi":2}},"1210":{"name_enus":"Shadowgem","quality":2,"icon":"inv_misc_gem_amethyst_01"},"3470":{"name_enus":"Rough Grinding Stone","quality":1,"icon":"inv_stone_grindingstone_01"},"7935":{"name_enus":"Ornate Mithril Breastplate","quality":2,"icon":"inv_chest_plate10","jsonequip":{"armor":463,"critstrkrtng":14,"dodgertng":12,"reqlevel":43,"slotbak":5}},"3860":{"name_enus":"Mithril Bar","quality":1,"icon":"inv_ingot_06"},"6037":{"name_enus":"Truesilver Bar","quality":2,"icon":"inv_ingot_08"},"7909":{"name_enus":"Aquamarine","quality":2,"icon":"inv_misc_gem_crystal_02"},"7971":{"name_enus":"Black Pearl","quality":2,"icon":"inv_misc_gem_pearl_02"},"7954":{"name_enus":"The Shatterer","quality":3,"icon":"inv_hammer_18","jsonequip":{"dmgmax1":99,"dmgmin1":53,"dps":31.67,"reqlevel":42,"slotbak":13,"speed":2.4}},"7075":{"name_enus":"Core of Earth","quality":1,"icon":"inv_stone_15"},"3837":{"name_enus":"Golden Scale Coif","quality":2,"icon":"inv_helmet_24","jsonequip":{"armor":215,"reqlevel":33,"slotbak":1,"agi":4,"sta":8,"firres":5}},"3859":{"name_enus":"Steel Bar","quality":1,"icon":"inv_ingot_steel"},"3577":{"name_enus":"Gold Bar","quality":2,"icon":"inv_ingot_03"}});
WH.Gatherer.addData(6, 16, {"2660":{"name_enus":"Rough Sharpening Stone","icon":"inv_stone_sharpeningstone_01"}});
var listviewspells = [{"cat":11,"id":2018,"learnedat":9999,"level":0,"name":"Blacksmithing","nskillup":0,"quality":-1,"schools":1,"skill":[164],"source":[6],"trainingcost":10,quality:-1,popularity:1800},{"cat":11,"id":9787,"learnedat":9999,"level":0,"name":"Weaponsmith","schools":1,"skill":[164],"source":[4],"specialization":9787,popularity:12},{"cat":11,"colors":[0,15,35,55],"creates":[2862,1,1],"id":2660,"learnedat":15,"level":0,"name":"Rough Sharpening Stone","nskillup":1,"quality":1,"reagents":[[2835,1]],"schools":1,"skill":[164],"envChange":{"status":"unchanged","labels":[],"lines":[]},quality:1,popularity:650},{"cat":11,"colors":[15,50,70,90],"creates":[2852,1,1],"id":2662,"learnedat":15,"level":0,"name":"Copper Chain Pants","nskillup":1,"quality":2,"reagents":[[2840,4]],"schools":1,"skill":[164],"source":[6],"trainingcost":50,quality:2,popularity:136},{"cat":11,"colors":[80,95,115,135],"creates":[2864,1,1],"id":2667,"learnedat":80,"level":0,"name":"Runed Copper Breastplate","nskillup":1,"quality":2,"reagents":[[2840,12],[1210,1],[3470,2]],"schools":1,"skill":[164],"source":[2,21],quality:2,popularity:253},{"cat":11,"colors":[240,260,275,290],"creates":[7935,1,1],"id":9972,"learnedat":240,"level":0,"name":"Ornate Mithril Breastplate","nskillup":1,"quality":2,"reagents":[[3860,16],[6037,6],[7909,1],[7971,1]],"schools":1,"skill":[164],quality:2,popularity:40},{"cat":11,"colors":[235,255,270,285],"creates":[7954,1,1],"id":10003,"learnedat":235,"level":0,"name":"The Shatterer","nskillup":1,"quality":3,"reagents":[[3860,24],[7075,4]],"schools":1,"skill":[164],"specialization":17040,"trainingcost":13500,quality:3,popularity:55},{"cat":11,"colors":[190,210,227,245],"creates":[3837,1,1],"id":3503,"learnedat":190,"level":0,"name":"Golden Scale Coif","nskillup":1,"quality":2,"reagents":[[3859,8],[3577,2]],"schools":1,"skill":[164],"source":[5],quality:2,popularity:70}];
new Listview({template: 'spell', id: 'spells', sort: ['skill', 'name'], data: listviewspells});
//]]>`;

const blacksmithingRecipes = `//<![CDATA[
WH.Gatherer.addData(3, 16, {"2881":{"name_enus":"Plans: Runed Copper Breastplate","quality":2,"icon":"inv_scroll_03"},"6047":{"name_enus":"Plans: Golden Scale Coif","quality":2,"icon":"inv_scroll_03"},"7975":{"name_enus":"Plans: Ornate Mithril Breastplate","quality":2,"icon":"inv_scroll_03"}});
var listviewitems = [{"classs":9,"displayName":"Plans: Runed Copper Breastplate","flags2":24580,"id":2881,"level":18,"name":"Plans: Runed Copper Breastplate","quality":2,"skill":55,"slot":0,"source":[2,21],"sourcemore":[{"dd":-1,"n":"Defias Renegade Mage","t":1,"ti":450,"z":40}],"subclass":4,"envChange":{"status":"updated","labels":["requirements_changed"],"lines":["Skill Blacksmithing (55) instead of Blacksmithing (80)"],"notShown":[]},firstseenpatch: 0,popularity:616},{"classs":9,"id":6047,"level":38,"name":"Plans: Golden Scale Coif","quality":2,"skill":190,"slot":0,"source":[5],"sourcemore":[{"n":"Krinkle Goodsteel","t":1,"ti":5411,"z":440}],"subclass":4,firstseenpatch: 0,popularity:77},{"classs":9,"id":7975,"level":48,"name":"Plans: Ornate Mithril Breastplate","quality":2,"skill":240,"slot":0,"source":[4],"sourcemore":[{"c":-121,"c2":5,"n":"Ornate Mithril Armor","t":5,"ti":2771}],"subclass":4,firstseenpatch: 0,popularity:31},{"classs":9,"id":12345,"level":60,"name":"Plans: Something Wowhead Lists Alone","quality":3,"skill":300,"slot":0,"subclass":4,firstseenpatch: 0,popularity:1}];
new Listview({template: 'item', id: 'items', data: listviewitems});
//]]>`;

const enchantingSpells = `//<![CDATA[
WH.Gatherer.addData(3, 16, {"10940":{"name_enus":"Strange Dust","quality":1,"icon":"inv_enchant_duststrange"},"11288":{"name_enus":"Greater Magic Wand","quality":2,"icon":"inv_wand_07","jsonequip":{"dmgmax1":21,"dmgmin1":11,"dps":10.7,"reqlevel":8,"slotbak":26,"speed":1.5}},"4470":{"name_enus":"Simple Wood","quality":1,"icon":"inv_tradeskillitem_01"},"11083":{"name_enus":"Soul Dust","quality":1,"icon":"inv_enchant_dustsoul"}});
var listviewspells = [{"cat":11,"id":7411,"learnedat":9999,"name":"Enchanting","skill":[333],"source":[6],popularity:900},{"cat":11,"colors":[1,70,90,110],"id":7418,"learnedat":1,"level":0,"name":"Enchant Bracer - Minor Health","nskillup":1,"quality":-1,"reagents":[[10940,1]],"schools":1,"skill":[333],"source":[6],"trainingcost":10,popularity:800},{"cat":11,"colors":[70,110,130,150],"creates":[11288,1,1],"id":14807,"learnedat":70,"level":0,"name":"Greater Magic Wand","nskillup":1,"quality":2,"reagents":[[4470,1],[11083,1]],"schools":1,"skill":[333],"source":[6],"trainingcost":200,popularity:300}];
new Listview({template: 'spell', id: 'spells', data: listviewspells});
//]]>`;

const enchantingRecipes = `//<![CDATA[
var listviewitems = [{"classs":9,"id":6375,"level":24,"name":"Formula: Enchant Bracer - Lesser Spirit","quality":2,"skill":120,"source":[5],"sourcemore":[{"n":"Kulwia","t":1,"ti":3954,"z":406}],"subclass":8,popularity:20}];
new Listview({template: 'item', id: 'items', data: listviewitems});
//]]>`;

export const snapshot = {
  source: 'wowhead',
  version: 'forever',
  fetched: '2026-11-11T12:00:00.000Z',
  pages: [
    { profession: 'Blacksmithing', kind: 'spells', url: 'https://www.wowhead.com/forever/spells/professions/blacksmithing', scripts: [blacksmithingSpells] },
    { profession: 'Blacksmithing', kind: 'recipes', url: 'https://www.wowhead.com/forever/items/recipes/blacksmithing', scripts: [blacksmithingRecipes] },
    { profession: 'Enchanting', kind: 'spells', url: 'https://www.wowhead.com/forever/spells/professions/enchanting', scripts: [enchantingSpells] },
    { profession: 'Enchanting', kind: 'recipes', url: 'https://www.wowhead.com/forever/items/recipes/enchanting', scripts: [enchantingRecipes] },
  ],
};
