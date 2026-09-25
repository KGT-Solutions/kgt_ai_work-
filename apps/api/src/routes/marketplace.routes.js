const express = require('express');
const prisma = require('../lib/prisma');
const { requireRole } = require('../middleware/rbac');
const router = express.Router();

function formatSellerLabel(flat) {
  if (!flat?.number) return null;
  const [wing, num] = flat.number.includes('-') ? flat.number.split('-') : [null, flat.number];
  if (wing && num) return `Wing ${wing} • Flat ${num}`;
  return `Flat ${flat.number}`;
}

function mapListing(l) {
  const flat = l.user?.memberships?.[0]?.flat || null;
  return {
    id: l.id,
    buildingId: l.buildingId,
    userId: l.userId,
    type: l.type,
    title: l.title,
    price: l.price,
    createdAt: l.createdAt,
    sellerName: l.user?.name || null,
    flatLabel: formatSellerLabel(flat),
    flatNumber: flat?.number || null
  };
}

router.get('/', requireRole('resident'), async (req, res) => {
  const listings = await prisma.marketplaceListing.findMany({
    where: { buildingId: req.buildingId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          memberships: {
            where: {
              buildingId: req.buildingId,
              status: 'approved',
              role: { key: 'resident' }
            },
            include: { flat: { select: { number: true } } },
            take: 1
          }
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
  res.json(listings.map(mapListing));
});

router.get('/mine', requireRole('resident'), async (req, res) => {
  const listings = await prisma.marketplaceListing.findMany({
    where: { buildingId: req.buildingId, userId: req.user.id },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          memberships: {
            where: {
              buildingId: req.buildingId,
              status: 'approved',
              role: { key: 'resident' }
            },
            include: { flat: { select: { number: true } } },
            take: 1
          }
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
  res.json(listings.map(mapListing));
});

router.post('/', requireRole('resident'), async (req, res) => {
  const { type, title, price } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  if (!type?.trim()) return res.status(400).json({ error: 'type is required' });

  const listing = await prisma.marketplaceListing.create({
    data: {
      buildingId: req.buildingId,
      userId: req.user.id,
      type: type.trim(),
      title: title.trim(),
      price: price != null && price !== '' ? Number(price) : null
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          memberships: {
            where: {
              buildingId: req.buildingId,
              status: 'approved',
              role: { key: 'resident' }
            },
            include: { flat: { select: { number: true } } },
            take: 1
          }
        }
      }
    }
  });
  res.json(mapListing(listing));
});

router.delete('/:id', requireRole('resident'), async (req, res) => {
  const existing = await prisma.marketplaceListing.findFirst({
    where: { id: req.params.id, buildingId: req.buildingId }
  });
  if (!existing) return res.status(404).json({ error: 'Listing not found' });
  if (existing.userId !== req.user.id) return res.status(403).json({ error: 'Not your listing' });

  await prisma.marketplaceListing.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

module.exports = router;
