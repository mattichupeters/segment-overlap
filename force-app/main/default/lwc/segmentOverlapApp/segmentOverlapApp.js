import { LightningElement, track } from 'lwc';
import getSegments from '@salesforce/apex/SegmentOverlapController.getSegments';
import calculateMultiOverlap from '@salesforce/apex/SegmentOverlapController.calculateMultiOverlap';
import createSegmentFromOverlap from '@salesforce/apex/SegmentOverlapController.createSegmentFromOverlap';
import createSegmentFromZone from '@salesforce/apex/SegmentOverlapController.createSegmentFromZone';

// Salesforce CRM Analytics palette — matches Engagement Insights dashboard charts
const SF_COLORS = [
    { border: '#05A569', fill: 'rgba(5,165,105,0.18)',  text: '#035E3E' },   // Green
    { border: '#1B96FF', fill: 'rgba(27,150,255,0.18)', text: '#014486' },   // Blue
    { border: '#CB65FF', fill: 'rgba(203,101,255,0.18)', text: '#6B00A8' },  // Magenta/Purple
    { border: '#FF5D2D', fill: 'rgba(255,93,45,0.18)',  text: '#BA4011' }    // Coral/Orange
];

export default class SegmentOverlapApp extends LightningElement {
    @track isLoadingSegments = true;
    @track segmentsLoaded    = false;
    @track segmentLoadError  = '';

    @track segmentOptions = [];
    @track selectedIds    = ['', ''];   // Start with 2 slots

    @track isCalculating = false;
    @track calcError     = '';
    @track result        = null;

    // Create segment state
    @track showCreateModal   = false;
    @track newSegmentName    = '';
    @track isCreatingSegment = false;
    @track createError       = '';
    @track createSuccess     = '';

    // Zone-click state
    @track zoneIncludeIds    = [];
    @track zoneExcludeIds    = [];
    @track zoneDescription   = '';
    @track isZoneCreate      = false;

    _segmentMap = {};

    connectedCallback() {
        this._loadSegments();
    }

    async _loadSegments() {
        this.isLoadingSegments = true;
        this.segmentLoadError  = '';
        try {
            const segments = await getSegments();
            this._segmentMap   = {};
            this.segmentOptions = segments.map(s => {
                this._segmentMap[s.id] = s;
                return {
                    label: `${s.name} (${this._fmt(s.count)})`,
                    value: s.id
                };
            });
            this.segmentsLoaded = true;
        } catch (err) {
            this.segmentLoadError =
                err?.body?.message ?? 'Failed to load segments from Data Cloud.';
        } finally {
            this.isLoadingSegments = false;
        }
    }

    // ─── Segment slot management ──────────────────────────────────────────────

    get segmentSlots() {
        return this.selectedIds.map((id, i) => ({
            key:   `seg-${i}`,
            name:  `segment${i}`,
            label: `Segment ${String.fromCharCode(65 + i)}`,
            value: id,
            index: String(i)
        }));
    }

    get canAddSegment()    { return this.selectedIds.length < 4; }
    get canRemoveSegment() { return this.selectedIds.length > 2; }

    handleAddSegment() {
        this.selectedIds = [...this.selectedIds, ''];
        this.result = null;
        this.calcError = '';
    }

    handleRemoveSegment() {
        this.selectedIds = this.selectedIds.slice(0, -1);
        this.result = null;
        this.calcError = '';
    }

    handleSegmentChange(e) {
        const idx = parseInt(e.target.dataset.index, 10);
        const updated = [...this.selectedIds];
        updated[idx] = e.detail.value;
        this.selectedIds = updated;
        this.result = null;
        this.calcError = '';
    }

    // ─── Validation ───────────────────────────────────────────────────────────

    get hasDuplicateSegments() {
        const filled = this.selectedIds.filter(id => id);
        return new Set(filled).size < filled.length;
    }

    get isCalculateDisabled() {
        const allFilled = this.selectedIds.every(id => id);
        return !allFilled || this.hasDuplicateSegments || this.isCalculating;
    }

    // ─── Calculate ────────────────────────────────────────────────────────────

    async handleCalculate() {
        this.isCalculating = true;
        this.calcError     = '';
        this.result        = null;
        try {
            const data = await calculateMultiOverlap({
                segmentIds: this.selectedIds
            });
            this.result = {
                segments:   data.segments,
                pairwise:   data.pairwise,
                allOverlap: Number(data.allOverlap) || 0,
                names:      this.selectedIds.map(id => this._segmentMap[id]?.name ?? 'Unknown'),
                counts:     data.segments.map(s => Number(s.memberCount) || 0)
            };
        } catch (err) {
            this.calcError =
                err?.body?.message ?? 'Failed to calculate overlap.';
        } finally {
            this.isCalculating = false;
        }
    }

    // ─── Result display ───────────────────────────────────────────────────────

    get hasResults() { return this.result !== null; }

    get segmentStats() {
        if (!this.result) return [];
        return this.result.segments.map((seg, i) => ({
            key:            `stat-${i}`,
            label:          this.result.names[i],
            formattedCount: this._fmtFull(this.result.counts[i]),
            dotStyle:       `background-color: ${SF_COLORS[i].border}`
        }));
    }

    get formattedAllOverlap() {
        return this.result ? this._fmtFull(this.result.allOverlap) : '0';
    }

    get showPairwiseTable() {
        return this.result && this.result.segments.length > 2;
    }

    get pairwiseRows() {
        if (!this.result) return [];
        const rows = [];
        const pw = this.result.pairwise;
        const names = this.result.names;
        const counts = this.result.counts;
        for (const key of Object.keys(pw)) {
            const [i, j] = key.split('_').map(Number);
            const overlap = Number(pw[key]) || 0;
            const smaller = Math.min(counts[i], counts[j]);
            const pct = smaller > 0
                ? ((overlap / smaller) * 100).toFixed(1) + '%'
                : '0%';
            rows.push({
                key,
                label:           `${names[i]} ∩ ${names[j]}`,
                formattedOverlap: this._fmtFull(overlap),
                pct
            });
        }
        return rows;
    }

    get segmentsJsonForVenn() {
        if (!this.result) return '[]';
        return JSON.stringify(this.result.segments.map((seg, i) => ({
            name:     this.result.names[i],
            count:    this.result.counts[i],
            color:    SF_COLORS[i].border,
            fill:     SF_COLORS[i].fill,
            textFill: SF_COLORS[i].text
        })));
    }

    get overlapJsonForVenn() {
        if (!this.result) return '{}';
        return JSON.stringify({
            pairwise: this.result.pairwise || {},
            allOverlap: this.result.allOverlap || 0,
            counts: this.result.counts || []
        });
    }

    // ─── Create segment from overlap ────────────────────────────────────────────

    get canCreateSegment() {
        return this.result !== null;
    }

    get selectedSegmentCount() {
        return this.selectedIds.length;
    }

    get isCreateDisabled() {
        return !this.newSegmentName || !this.newSegmentName.trim() || this.isCreatingSegment;
    }

    get createButtonLabel() {
        return this.isCreatingSegment ? 'Creating…' : 'Create Segment';
    }

    get createModalTitle() {
        return this.isZoneCreate
            ? 'Create Segment from Zone'
            : 'Create Segment from Overlap';
    }

    get createModalDescription() {
        if (this.isZoneCreate) {
            return this.zoneDescription;
        }
        return null;
    }

    get createModalOverlapDescription() {
        if (!this.isZoneCreate && this.result) {
            return `This will create a new Data Cloud segment containing the ${this.formattedAllOverlap} members that overlap across all ${this.selectedSegmentCount} selected segments.`;
        }
        return null;
    }

    // ─── Zone click from Venn diagram ─────────────────────────────────────────

    handleZoneClick(event) {
        const { include, exclude } = event.detail;

        // Map indices to actual segment IDs and names
        const includeIds = include.map(i => this.selectedIds[i]);
        const excludeIds = exclude.map(i => this.selectedIds[i]);

        const includeNames = include.map(i => this._segmentMap[this.selectedIds[i]]?.name ?? 'Unknown');
        const excludeNames = exclude.map(i => this._segmentMap[this.selectedIds[i]]?.name ?? 'Unknown');

        // Build a human-readable description of the zone
        let desc = 'Members in ' + includeNames.join(' AND ');
        if (excludeNames.length > 0) {
            desc += ', but NOT in ' + excludeNames.join(' or ');
        }

        this.zoneIncludeIds  = includeIds;
        this.zoneExcludeIds  = excludeIds;
        this.zoneDescription = desc;
        this.isZoneCreate    = true;
        this.showCreateModal = true;
        this.newSegmentName  = '';
        this.createError     = '';
        this.createSuccess   = '';
    }

    handleOpenCreateModal() {
        // Intersection of all segments — include all, exclude none
        const allNames = this.selectedIds.map(id => this._segmentMap[id]?.name ?? 'Unknown');
        this.isZoneCreate    = true;
        this.zoneIncludeIds  = [...this.selectedIds];
        this.zoneExcludeIds  = [];
        this.zoneDescription = 'Members in ' + allNames.join(' AND ') + ' (overlap across all selected segments)';
        this.showCreateModal = true;
        this.newSegmentName  = '';
        this.createError     = '';
    }

    handleCloseCreateModal() {
        this.showCreateModal = false;
        this.newSegmentName  = '';
        this.isZoneCreate    = false;
        this.zoneIncludeIds  = [];
        this.zoneExcludeIds  = [];
        this.zoneDescription = '';
    }

    handleSegmentNameChange(e) {
        this.newSegmentName = e.detail.value;
    }

    async handleCreateSegment() {
        if (!this.newSegmentName || !this.newSegmentName.trim()) return;

        this.isCreatingSegment = true;
        this.createError       = '';
        this.createSuccess     = '';
        try {
            let result;
            if (this.isZoneCreate) {
                // Zone-based creation (clicked a specific Venn region)
                result = await createSegmentFromZone({
                    includeIds:  this.zoneIncludeIds,
                    excludeIds:  this.zoneExcludeIds,
                    segmentName: this.newSegmentName.trim()
                });
            } else {
                // Legacy all-overlap creation
                result = await createSegmentFromOverlap({
                    segmentIds:  this.selectedIds,
                    segmentName: this.newSegmentName.trim()
                });
            }
            this.createSuccess   = result.displayName || this.newSegmentName.trim();
            this.showCreateModal = false;
            this.newSegmentName  = '';
        } catch (err) {
            this.createError =
                err?.body?.message ?? 'Failed to create segment. Please try again.';
            this.showCreateModal = false;
        } finally {
            this.isCreatingSegment = false;
            this.isZoneCreate    = false;
            this.zoneIncludeIds  = [];
            this.zoneExcludeIds  = [];
            this.zoneDescription = '';
        }
    }

    // ─── Formatters ───────────────────────────────────────────────────────────

    _fmt(n) {
        const num = Number(n) || 0;
        if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
        if (num >= 1_000)     return (num / 1_000).toFixed(1) + 'K';
        return String(num);
    }

    _fmtFull(n) {
        return (Number(n) || 0).toLocaleString();
    }
}