import { Select } from '..';

// Overview page header: title + live status + the date-range / branch selects.
// Selects are controlled (data-ready) via props.
export default function OverviewHeader({
  live, rangeValue, rangeOptions, onRangeChange, branchValue, branchOptions, onBranchChange
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="orb-page-title text-orb-ink">Overview</h1>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="size-1.5 rounded-[3px] bg-orb-ink" />
          <span className="orb-small text-orb-secondary">{live}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Select ariaLabel="Date range" value={rangeValue} options={rangeOptions} onChange={onRangeChange} />
        <Select ariaLabel="Branch" value={branchValue} options={branchOptions} onChange={onBranchChange} />
      </div>
    </div>
  );
}
