/* Golden Hour Valley — static game data.
 * Every script attaches to the shared window.GHV namespace so the game runs
 * straight from index.html (no bundler, works from file://). */
(function (GHV) {
  'use strict';

  GHV.CONFIG = {
    TILE: 16,                 // base tile size in art pixels
    MAP_W: 64,
    MAP_H: 44,
    DAY_START: 6 * 60,        // 6:00 AM, in minutes after midnight
    PASS_OUT: 26 * 60,        // 2:00 AM the next morning
    GAME_MINUTES_PER_SECOND: 2, // 20 in-game hours ≈ 10 real minutes
    MAX_ENERGY: 100,
    START_GOLD: 200,
    HOTBAR_SIZE: 10,
    INVENTORY_SIZE: 30,
    STACK_SIZE: 99,
    REACH: 1,                 // tiles the player can act on around them
    WALK_SPEED: 72,           // art pixels per second
    PASS_OUT_PENALTY: 0.1,    // fraction of gold lost when you pass out
    PASS_OUT_PENALTY_CAP: 500,
    SHOP_OPEN: 8 * 60,
    SHOP_CLOSE: 20 * 60,
    SUNSHOWER_CHANCE: 0.18,
    MAX_FORAGE: 14,
    WEEDS_PER_NIGHT: 3,
    LANTERN_REWARD: 1000,
    BLESSING_CHANCE: 0.15,    // extra growth per night once the lantern is lit
    SAVE_KEY: 'golden-hour-valley-save-v1',
    SETTINGS_KEY: 'golden-hour-valley-settings-v1',
  };

  // Watering can tiers: capacity by level.
  GHV.CAN_LEVELS = [
    { name: 'Watering Can', capacity: 20 },
    { name: 'Copper Watering Can', capacity: 45 },
    { name: 'Golden Watering Can', capacity: 80 },
  ];

  /* Items. kind: tool | seed | crop | forage | material | food | placeable
   * sell: price at the shipping bin. price: cost at Mabel's stall.
   * energy: energy restored when eaten (edible items only). */
  GHV.ITEMS = {
    hoe:            { name: 'Hoe', kind: 'tool', cost: 2, desc: 'Turns farm grass into soft soil.' },
    can:            { name: 'Watering Can', kind: 'tool', cost: 1, desc: 'Waters soil. Refill it at any water.' },
    sickle:         { name: 'Sickle', kind: 'tool', cost: 1, desc: 'Clears weeds. Weeds sometimes leave fiber.' },
    pickaxe:        { name: 'Pickaxe', kind: 'tool', cost: 3, desc: 'Breaks rocks, untills soil, picks up sprinklers.' },

    sunwheat_seed:  { name: 'Sunwheat Seeds', kind: 'seed', crop: 'sunwheat', price: 10, desc: 'Grows in 3 days. Hardy and golden.' },
    carrot_seed:    { name: 'Amber Carrot Seeds', kind: 'seed', crop: 'amber_carrot', price: 20, desc: 'Grows in 4 days.' },
    duskberry_seed: { name: 'Duskberry Seeds', kind: 'seed', crop: 'duskberry', price: 45, desc: 'Grows in 5 days, then fruits again every 2 days.' },
    melon_seed:     { name: 'Honey Melon Seeds', kind: 'seed', crop: 'honey_melon', price: 60, desc: 'Grows in 7 days. Sweet as late sun.' },
    pumpkin_seed:   { name: 'Ember Pumpkin Seeds', kind: 'seed', crop: 'ember_pumpkin', price: 90, desc: 'Grows in 9 days. Glows faintly at dusk.' },

    sunwheat:       { name: 'Sunwheat', kind: 'crop', sell: 28, desc: 'A sheaf of wheat the colour of 5 PM.' },
    amber_carrot:   { name: 'Amber Carrot', kind: 'crop', sell: 50, energy: 15, desc: 'Crunchy. Restores a little energy.' },
    duskberry:      { name: 'Duskberry', kind: 'crop', sell: 32, energy: 10, desc: 'Tastes like the first star coming out.' },
    honey_melon:    { name: 'Honey Melon', kind: 'crop', sell: 160, energy: 40, desc: 'Heavy, fragrant, and worth it.' },
    ember_pumpkin:  { name: 'Ember Pumpkin', kind: 'crop', sell: 300, desc: 'Warm to the touch, even at night.' },

    poppy:          { name: 'Golden Poppy', kind: 'forage', sell: 18, desc: 'Grows wild wherever the light lingers.' },
    glowcap:        { name: 'Glowcap', kind: 'forage', sell: 40, energy: 20, desc: 'A mushroom that hums with stored sunlight.' },

    stone:          { name: 'Stone', kind: 'material', sell: 2, desc: 'A plain stone. Mabel uses them for her garden wall.' },
    fiber:          { name: 'Fiber', kind: 'material', sell: 1, desc: 'Tough plant fiber.' },

    honey_bun:      { name: 'Honey Bun', kind: 'food', price: 45, sell: 15, energy: 40, desc: "Mabel's own recipe. Restores 40 energy." },
    sun_tea:        { name: 'Sun Tea', kind: 'food', price: 90, sell: 30, energy: 80, desc: 'Brewed on the windowsill all afternoon. Restores 80 energy.' },
    sprinkler:      { name: 'Brass Sprinkler', kind: 'placeable', price: 250, sell: 60, desc: 'Place on the farm. Waters the 8 tiles around it every morning.' },
  };

  /* Crops. stages: watered days spent in each growth stage before maturing.
   * regrow: if set, harvesting resets the plant this many days before maturity. */
  GHV.CROPS = {
    sunwheat:      { name: 'Sunwheat', product: 'sunwheat', stages: [1, 1, 1], yield: [1, 2] },
    amber_carrot:  { name: 'Amber Carrot', product: 'amber_carrot', stages: [1, 1, 2], yield: [1, 1] },
    duskberry:     { name: 'Duskberry', product: 'duskberry', stages: [1, 2, 2], regrow: 2, yield: [2, 3] },
    honey_melon:   { name: 'Honey Melon', product: 'honey_melon', stages: [2, 2, 3], yield: [1, 1] },
    ember_pumpkin: { name: 'Ember Pumpkin', product: 'ember_pumpkin', stages: [2, 3, 4], yield: [1, 1] },
  };

  // What Mabel's stall sells, in display order.
  GHV.SHOP_STOCK = [
    'sunwheat_seed', 'carrot_seed', 'duskberry_seed', 'melon_seed', 'pumpkin_seed',
    'honey_bun', 'sun_tea', 'sprinkler',
  ];

  // One-off upgrades sold at the stall.
  GHV.UPGRADES = [
    { id: 'can1', name: 'Copper Watering Can', desc: 'Holds 45 water.', price: 600, canLevel: 1 },
    { id: 'can2', name: 'Golden Watering Can', desc: 'Holds 80 water.', price: 2000, canLevel: 2, requires: 'can1' },
    { id: 'energy1', name: 'Hearty Breakfast Plan', desc: 'Max energy +30, permanently.', price: 1200, maxEnergy: 30 },
  ];

  // The Great Lantern offering: the goal of the game.
  GHV.OFFERING = [
    { item: 'sunwheat', qty: 20 },
    { item: 'amber_carrot', qty: 12 },
    { item: 'duskberry', qty: 15 },
    { item: 'honey_melon', qty: 5 },
    { item: 'ember_pumpkin', qty: 3 },
    { item: 'glowcap', qty: 6 },
  ];

  GHV.STARTING_INVENTORY = [
    { id: 'hoe', qty: 1 },
    { id: 'can', qty: 1 },
    { id: 'sickle', qty: 1 },
    { id: 'pickaxe', qty: 1 },
    { id: 'sunwheat_seed', qty: 15 },
    { id: 'carrot_seed', qty: 5 },
    { id: 'honey_bun', qty: 2 },
  ];

  GHV.WEATHER = {
    clear: { name: 'Clear', icon: '☀' },
    sunshower: { name: 'Sunshower', icon: '🌦' },
  };

  GHV.SEASONS = ['Ambertide', 'Emberwane', 'Honeyfrost', 'Goldbloom'];
  GHV.SEASON_LENGTH = 28;
})(window.GHV = window.GHV || {});
