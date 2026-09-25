/** Sample listings shown only when a society has zero live marketplace ads. */
export const DUMMY_MARKETPLACE_LISTINGS = [
  {
    id: 'dummy-sofa',
    type: 'sale',
    title: '3 Seater Sofa',
    price: 8500,
    flatLabel: 'Wing B • Flat 210',
    image: require('../../assets/marketplace/sofa.jpeg'),
    tint: '#e0ebdb',
    color: '#6d8f63',
    icon: 'bed-outline'
  },
  {
    id: 'dummy-fridge',
    type: 'sale',
    title: 'Samsung Refrigerator',
    price: 12000,
    flatLabel: 'Wing A • Flat 104',
    image: require('../../assets/marketplace/refrigerator.jpg'),
    tint: '#e4ecf7',
    color: '#5b7fb0',
    icon: 'snow-outline'
  },
  {
    id: 'dummy-cycle',
    type: 'sale',
    title: 'Hero Sprint Cycle',
    price: 3200,
    flatLabel: 'Wing C • Flat 307',
    image: require('../../assets/marketplace/cycle.jpg'),
    tint: '#f7e9d8',
    color: '#c78a4a',
    icon: 'bicycle-outline',
    isNew: true
  },
  {
    id: 'dummy-table',
    type: 'sale',
    title: 'Study Table with Chair',
    price: 4000,
    flatLabel: 'Wing D • Flat 118',
    image: require('../../assets/marketplace/study-table.jpg'),
    tint: '#eae6f5',
    color: '#8a6db3',
    icon: 'desktop-outline'
  }
];

export const MARKETPLACE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'sale', label: 'For sale' },
  { key: 'rent', label: 'For rent' },
  { key: 'service', label: 'Services' }
];

export function listingIconMeta(type) {
  switch (type) {
    case 'rent':
      return { icon: 'key-outline', tint: '#e4ecf7', color: '#5b7fb0' };
    case 'service':
      return { icon: 'construct-outline', tint: '#f7e9d8', color: '#c78a4a' };
    default:
      return { icon: 'pricetag-outline', tint: '#d3f6e3', color: '#059669' };
  }
}
