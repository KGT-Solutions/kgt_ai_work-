import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../../components/AdminLayout';
import FlatDetailPanel from '../../../components/FlatDetailPanel';
import { ui, gridClass } from '../../../components/ui';
import { api } from '../../../lib/api';
import { displayTowerName } from '../../../lib/towers';

const FLOOR_LETTERS = ['A', 'B', 'C', 'D'];

export default function FlatsPage() {
  const router = useRouter();
  const { buildingId } = router.query;
  const [flats, setFlats] = useState([]);
  const [towers, setTowers] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedFlat, setSelectedFlat] = useState(null);
  const [saving, setSaving] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  const [towerName, setTowerName] = useState('');
  const [rangeTower, setRangeTower] = useState('');
  const [floorLetter, setFloorLetter] = useState('A');
  const [rangeStart, setRangeStart] = useState('101');
  const [rangeEnd, setRangeEnd] = useState('110');
  const [customNumbers, setCustomNumbers] = useState('');
  const [mode, setMode] = useState('range'); // range | custom
  const [floorMode, setFloorMode] = useState('infer'); // same | infer | custom
  const [sameFloor, setSameFloor] = useState('1');
  const [customFloors, setCustomFloors] = useState('');
  const [bhkType, setBhkType] = useState('');

  const load = useCallback(async () => {
    if (!buildingId) return;
    setError('');
    try {
      const [flatList, towerList] = await Promise.all([
        api.getFlats(buildingId),
        api.getWings(buildingId)
      ]);
      setFlats(flatList);
      setTowers(towerList);
      setRangeTower((prev) => prev || towerList[0]?.id || '');
    } catch (e) {
      setError(e.message);
    } finally {
      setInitialLoading(false);
    }
  }, [buildingId]);

  useEffect(() => { load(); }, [load]);

  if (!buildingId) return null;

  const occupied = flats.filter((f) => f.occupied).length;
  const vacant = flats.length - occupied;

  const byTower = flats.reduce((acc, flat) => {
    const key = flat.wing || 'Unknown';
    if (!acc[key]) acc[key] = [];
    acc[key].push(flat);
    return acc;
  }, {});

  const selectedTower = towers.find((w) => w.id === rangeTower);
  const previewRange = mode === 'range' && rangeStart && rangeEnd
    ? `${floorLetter}-${rangeStart} … ${floorLetter}-${rangeEnd}`
    : null;

  const addTower = async () => {
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const tower = await api.createWing(buildingId, { name: towerName });
      setSuccess(`Added ${displayTowerName(tower.name)}`);
      setTowerName('');
      await load();
      setRangeTower(tower.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const addFlats = async () => {
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      let payload = { floorMode, floorLetter };
      if (rangeTower) payload.wingId = rangeTower;
      else if (towerName.trim()) payload.wingName = towerName.trim();
      else throw new Error('Select or create a tower first');

      if (floorMode === 'same') {
        const floor = Number(sameFloor);
        if (!Number.isInteger(floor) || floor < 0) throw new Error('Enter a valid floor number');
        payload.floor = floor;
      }

      if (mode === 'custom') {
        const numbers = customNumbers.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
        if (!numbers.length) throw new Error('Enter at least one flat number (e.g. A-101, 102)');
        payload.numbers = numbers;
        if (floorMode === 'custom') {
          const floors = customFloors.split(/[\s,]+/).map((s) => s.trim()).filter((s) => s !== '');
          if (floors.length && floors.length !== numbers.length) {
            throw new Error('Provide one floor per flat number (same count), or leave floors blank to infer');
          }
          if (floors.length) payload.floors = floors.map((f) => Number(f));
          else payload.floorMode = 'infer';
        }
      } else {
        payload.start = Number(rangeStart);
        payload.end = Number(rangeEnd);
        if (floorMode === 'custom') {
          throw new Error('Per-flat floors are only available in Custom numbers mode');
        }
      }

      if (bhkType) payload.bhkType = bhkType;

      const res = await api.addFlatRange(buildingId, payload);
      const createdCount = Array.isArray(res.created) ? res.created.length : 0;
      const skipped = res.skipped?.length ? ` · skipped ${res.skipped.length} existing` : '';
      setSuccess(`Added ${createdCount} flat(s) to ${displayTowerName(res.wing.name)}${skipped}`);
      setCustomNumbers('');
      setCustomFloors('');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout
      buildingId={buildingId}
      title="Flats"
      error={error}
      success={success}
      loading={initialLoading}
      skeletonVariant="flats"
    >
      <div className="admin-flats-page">
        <div className="admin-flats-form">
          <p className="admin-flats-form-title">Configure towers & flat ranges</p>
          <p className="admin-flats-hint">
            Add towers (Tower-01, Tower-02, …) and flat numbers using floor letters —
            A-101 is floor 1, B-102 is floor 2, C-104 is floor 3, and so on.
            Assign BHK size so maintenance can be charged by flat type.
          </p>

          <div className={`admin-flats-fields ${gridClass.manage}`}>
            <div className="admin-flats-field">
              <label className="admin-flats-label">Add tower</label>
              <div className="admin-tower-input-row">
                <input
                  className="admin-flats-input"
                  placeholder="Tower-01"
                  value={towerName}
                  onChange={(e) => setTowerName(e.target.value)}
                />
                <button
                  type="button"
                  className="admin-flats-btn-secondary"
                  onClick={addTower}
                  disabled={saving || !towerName.trim()}
                >
                  Add tower
                </button>
              </div>
            </div>

            <div className="admin-flats-field">
              <label className="admin-flats-label">Tower</label>
              <select
                className="admin-flats-input"
                value={rangeTower}
                onChange={(e) => setRangeTower(e.target.value)}
              >
                <option value="">Select tower</option>
                {towers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {displayTowerName(w.name)} ({w.flatCount} flats)
                  </option>
                ))}
              </select>
              <p className="admin-flats-hint admin-flats-hint--tight">
                Which tower these flats belong to (e.g. Tower-01). Floor letter goes in the flat number — A-101, B-102.
              </p>
            </div>

            <div className="admin-flats-field admin-flats-field--narrow">
              <label className="admin-flats-label">Floor letter</label>
              <select
                className="admin-flats-input"
                value={floorLetter}
                onChange={(e) => setFloorLetter(e.target.value)}
              >
                {FLOOR_LETTERS.map((letter) => (
                  <option key={letter} value={letter}>
                    {letter}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="admin-flats-mode-row" role="group" aria-label="Flat number mode">
            <button
              type="button"
              className={`admin-flats-mode-btn${mode === 'range' ? ' is-active' : ''}`}
              onClick={() => setMode('range')}
            >
              Number range
            </button>
            <button
              type="button"
              className={`admin-flats-mode-btn${mode === 'custom' ? ' is-active' : ''}`}
              onClick={() => setMode('custom')}
            >
              Custom numbers
            </button>
          </div>

          {mode === 'range' ? (
            <div className={`admin-flats-fields ${gridClass.manage}`}>
              <div className="admin-flats-field">
                <label className="admin-flats-label">From</label>
                <input
                  className="admin-flats-input"
                  value={rangeStart}
                  onChange={(e) => setRangeStart(e.target.value)}
                  inputMode="numeric"
                  placeholder="101"
                />
              </div>
              <div className="admin-flats-field">
                <label className="admin-flats-label">To</label>
                <input
                  className="admin-flats-input"
                  value={rangeEnd}
                  onChange={(e) => setRangeEnd(e.target.value)}
                  inputMode="numeric"
                  placeholder="110"
                />
              </div>
            </div>
          ) : (
            <div className="admin-flats-field">
              <label className="admin-flats-label">Flat numbers (comma-separated)</label>
              <input
                className="admin-flats-input"
                value={customNumbers}
                onChange={(e) => setCustomNumbers(e.target.value)}
                placeholder="A-101, B-102, 104"
              />
              <p className="admin-flats-hint admin-flats-hint--tight">
                Use floor letters (A-101, B-102) or plain numbers — plain numbers use the selected floor letter ({floorLetter}-104).
              </p>
            </div>
          )}

          <div className="admin-flats-section">
            <label className="admin-flats-label">Floor assignment</label>
            <div className="admin-flats-mode-row" role="group" aria-label="Floor assignment">
              <button
                type="button"
                className={`admin-flats-mode-btn${floorMode === 'infer' ? ' is-active' : ''}`}
                onClick={() => setFloorMode('infer')}
              >
                Infer from letter
              </button>
              <button
                type="button"
                className={`admin-flats-mode-btn${floorMode === 'same' ? ' is-active' : ''}`}
                onClick={() => setFloorMode('same')}
              >
                Same floor
              </button>
              {mode === 'custom' && (
                <button
                  type="button"
                  className={`admin-flats-mode-btn${floorMode === 'custom' ? ' is-active' : ''}`}
                  onClick={() => setFloorMode('custom')}
                >
                  Per flat
                </button>
              )}
            </div>
            {floorMode === 'infer' && (
              <p className="admin-flats-hint admin-flats-hint--tight">
                Floor letter maps to floor: A → 1, B → 2, C → 3 ({floorLetter}-101 → floor {floorLetter.charCodeAt(0) - 64}).
              </p>
            )}
            {floorMode === 'same' && (
              <div className="admin-flats-field admin-flats-field--narrow">
                <label className="admin-flats-label">Floor</label>
                <input
                  className="admin-flats-input"
                  value={sameFloor}
                  onChange={(e) => setSameFloor(e.target.value)}
                  inputMode="numeric"
                  placeholder="1"
                />
              </div>
            )}
            {floorMode === 'custom' && mode === 'custom' && (
              <div className="admin-flats-field">
                <label className="admin-flats-label">Floors (same order as flat numbers)</label>
                <input
                  className="admin-flats-input"
                  value={customFloors}
                  onChange={(e) => setCustomFloors(e.target.value)}
                  placeholder="1, 2, 3"
                />
              </div>
            )}
          </div>

          <div className="admin-flats-field admin-flats-field--bhk">
            <label className="admin-flats-label">Flat size (BHK)</label>
            <select
              className="admin-flats-input"
              value={bhkType}
              onChange={(e) => setBhkType(e.target.value)}
            >
              <option value="">Not set (use default rate)</option>
              <option value="1bhk">1 BHK</option>
              <option value="2bhk">2 BHK</option>
              <option value="3bhk">3 BHK</option>
            </select>
            <p className="admin-flats-hint admin-flats-hint--tight">
              Applied to all flats in this batch. You can change size later on each flat.
            </p>
          </div>

          {previewRange && selectedTower && (
            <p className="admin-flats-hint">
              Preview in {displayTowerName(selectedTower.name)}: {previewRange}
            </p>
          )}

          <button
            type="button"
            className="admin-flats-btn-accent"
            onClick={addFlats}
            disabled={saving || (!rangeTower && !towerName.trim())}
          >
            {saving ? 'Saving…' : 'Add flats'}
          </button>
        </div>

        <div className="admin-flats-legend">
          <span className="admin-flats-legend-item">
            <span className="admin-flats-dot admin-flats-dot--occupied" aria-hidden="true" />
            Occupied ({occupied})
          </span>
          <span className="admin-flats-legend-item">
            <span className="admin-flats-dot admin-flats-dot--vacant" aria-hidden="true" />
            Vacant ({vacant})
          </span>
        </div>

        {Object.keys(byTower).sort().map((tower) => (
          <section key={tower} className="admin-flats-tower">
            <h2 className="admin-flats-tower-title">{displayTowerName(tower)}</h2>
            <div className="admin-flats-grid">
              {byTower[tower].map((flat) => {
                const multiOwner = flat.residents?.some((r) => r.alsoOwns?.length > 0);
                return (
                  <button
                    key={flat.id}
                    type="button"
                    onClick={() => setSelectedFlat(flat)}
                    className={`admin-flats-tile${flat.occupied ? ' is-occupied' : ' is-vacant'}`}
                  >
                    <div className="admin-flats-tile-number">{flat.number}</div>
                    {(flat.floor != null || flat.bhkType) && (
                      <div className="admin-flats-tile-meta">
                        {flat.floor != null ? `Floor ${flat.floor}` : ''}
                        {flat.floor != null && flat.bhkType ? ' · ' : ''}
                        {flat.bhkType === '1bhk' ? '1 BHK' : flat.bhkType === '2bhk' ? '2 BHK' : flat.bhkType === '3bhk' ? '3 BHK' : ''}
                      </div>
                    )}
                    <div className="admin-flats-tile-status">
                      {flat.occupied ? (
                        <>
                          <span className="admin-flats-tile-state">Occupied</span>
                          {flat.residents[0] && (
                            <span className="admin-flats-tile-resident">{flat.residents[0].name}</span>
                          )}
                          {multiOwner && (
                            <span className="admin-flats-tile-multi">Multi-flat</span>
                          )}
                        </>
                      ) : (
                        <span className="admin-flats-tile-state">Vacant</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        {flats.length === 0 && !error && (
          <div style={ui.empty}>
            No flats yet. Add a tower and a range above (e.g. Tower-01 · A-101 to A-110).
          </div>
        )}
      </div>

      {selectedFlat && (
        <FlatDetailPanel
          buildingId={buildingId}
          flat={selectedFlat}
          onClose={() => setSelectedFlat(null)}
          onUpdated={async () => {
            await load();
            setSelectedFlat(null);
          }}
          onDeleted={async () => {
            setSuccess('Flat deleted');
            await load();
            setSelectedFlat(null);
          }}
        />
      )}
    </AdminLayout>
  );
}
