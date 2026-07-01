import { LightningElement, api } from 'lwc';

const W = 620;
const H = 400;
const R = 95;

/**
 * Circle center positions for 2, 3 or 4 circles, relative to SVG centre.
 * Overlap amounts tuned so zones are large enough to click.
 */
const LAYOUTS = {
    2: [
        { x: -50, y: 0 },
        { x:  50, y: 0 }
    ],
    3: [
        { x:   0, y: -42 },
        { x: -48, y:  32 },
        { x:  48, y:  32 }
    ],
    4: [
        { x: -42, y: -38 },
        { x:  42, y: -38 },
        { x: -42, y:  38 },
        { x:  42, y:  38 }
    ]
};

const CX = W / 2;
const CY = H / 2 - 8;

// ─── Geometry helpers ────────────────────────────────────────────────────

/**
 * Returns the two intersection points of circles c1 and c2 (each {x,y,r}).
 * Returns [] if circles don't intersect or are identical.
 */
function circleIntersections(c1, c2) {
    const dx = c2.x - c1.x;
    const dy = c2.y - c1.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > c1.r + c2.r || d < Math.abs(c1.r - c2.r) || d === 0) return [];
    const a = (c1.r * c1.r - c2.r * c2.r + d * d) / (2 * d);
    const h = Math.sqrt(c1.r * c1.r - a * a);
    const mx = c1.x + (a * dx) / d;
    const my = c1.y + (a * dy) / d;
    return [
        { x: mx + (h * dy) / d, y: my - (h * dx) / d },
        { x: mx - (h * dy) / d, y: my + (h * dx) / d }
    ];
}

/**
 * Angle of point p relative to center c, in radians.
 */
function angle(c, p) {
    return Math.atan2(p.y - c.y, p.x - c.x);
}

/**
 * SVG arc command from point p1 to p2 along a circle of radius r.
 * largeArc: 0 or 1, sweep: 0 or 1.
 */
function arc(p1, p2, r, largeArc, sweep) {
    return `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${largeArc} ${sweep} ${p2.x} ${p2.y}`;
}

/**
 * Determines if a test point is inside a circle.
 */
function insideCircle(pt, c) {
    const dx = pt.x - c.x;
    const dy = pt.y - c.y;
    return dx * dx + dy * dy < c.r * c.r;
}

/**
 * For 2 intersecting circles, returns the arc path for the lens (overlap).
 */
function lensPath(c1, c2, pts) {
    // Arc along c1 from pts[0] to pts[1] (the shorter arc on c1 side)
    // then arc along c2 from pts[1] back to pts[0] (the shorter arc on c2 side)
    const a1s = angle(c1, pts[0]);
    const a1e = angle(c1, pts[1]);
    const a2s = angle(c2, pts[1]);
    const a2e = angle(c2, pts[0]);

    // Determine sweep for each arc — we want the arc that goes through the overlap region
    // The midpoint of the overlap is between the two centres
    const mid = { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 };

    const sweep1 = arcSweepContaining(c1, pts[0], pts[1], mid);
    const sweep2 = arcSweepContaining(c2, pts[1], pts[0], mid);

    return `M ${pts[0].x} ${pts[0].y} ` +
           `A ${c1.r} ${c1.r} 0 ${sweep1.large} ${sweep1.dir} ${pts[1].x} ${pts[1].y} ` +
           `A ${c2.r} ${c2.r} 0 ${sweep2.large} ${sweep2.dir} ${pts[0].x} ${pts[0].y} Z`;
}

/**
 * Given a circle c, start point, end point, and a reference point that should
 * lie on the arc, determines the correct large-arc-flag and sweep-direction.
 */
function arcSweepContaining(c, start, end, refPt) {
    const aStart = angle(c, start);
    const aEnd = angle(c, end);
    const aRef = angle(c, refPt);

    // Try both sweep directions and pick the one whose angular range contains aRef
    for (const dir of [0, 1]) {
        for (const large of [0, 1]) {
            if (arcContainsAngle(aStart, aEnd, dir, large, aRef)) {
                return { large, dir };
            }
        }
    }
    // Fallback
    return { large: 0, dir: 1 };
}

function arcContainsAngle(aStart, aEnd, sweep, largeArc, testAngle) {
    // Normalise angles to [0, 2π)
    const TWO_PI = Math.PI * 2;
    const norm = a => ((a % TWO_PI) + TWO_PI) % TWO_PI;
    const s = norm(aStart);
    const e = norm(aEnd);
    const t = norm(testAngle);

    // Angular span going in sweep direction
    let span;
    if (sweep === 1) {
        // clockwise in SVG (positive y-down)
        span = norm(e - s);
    } else {
        span = norm(s - e);
    }

    const isLarge = span > Math.PI;
    if ((largeArc === 1) !== isLarge) return false;

    // Check if test angle is within the span
    let testSpan;
    if (sweep === 1) {
        testSpan = norm(t - s);
    } else {
        testSpan = norm(s - t);
    }
    return testSpan <= span + 0.001;
}

/**
 * Full circle path (used for "only" zones when circles don't overlap,
 * or as fallback).
 */
function fullCirclePath(c) {
    // Two semicircular arcs to form a closed circle
    const left  = { x: c.x - c.r, y: c.y };
    const right = { x: c.x + c.r, y: c.y };
    return `M ${left.x} ${left.y} ` +
           `A ${c.r} ${c.r} 0 1 1 ${right.x} ${right.y} ` +
           `A ${c.r} ${c.r} 0 1 1 ${left.x} ${left.y} Z`;
}

/**
 * "Exclusive" path for circle c1 — the part of c1 NOT inside c2.
 * (crescent / lune shape)
 */
function exclusivePath(c1, c2, pts) {
    // Point opposite to the overlap centre for reference
    const oppMid = { x: 2 * c1.x - (c1.x + c2.x) / 2,
                     y: 2 * c1.y - (c1.y + c2.y) / 2 };

    const sweep1 = arcSweepContaining(c1, pts[0], pts[1], oppMid);
    // The overlap edge goes back via c2, but on the side AWAY from c1's centre
    const overlapMid = { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 };
    const sweep2 = arcSweepContaining(c2, pts[1], pts[0], overlapMid);

    return `M ${pts[0].x} ${pts[0].y} ` +
           `A ${c1.r} ${c1.r} 0 ${sweep1.large} ${sweep1.dir} ${pts[1].x} ${pts[1].y} ` +
           `A ${c2.r} ${c2.r} 0 ${sweep2.large} ${sweep2.dir} ${pts[0].x} ${pts[0].y} Z`;
}

// ─── Zone builders ───────────────────────────────────────────────────────

function buildZones2(circles) {
    const [c1, c2] = circles;
    const pts = circleIntersections(c1, c2);
    if (pts.length < 2) {
        // No overlap — just 2 full circles, no overlap zone
        return [
            { path: fullCirclePath(c1), include: [0], exclude: [1], fill: c1.fillColor, stroke: c1.strokeColor },
            { path: fullCirclePath(c2), include: [1], exclude: [0], fill: c2.fillColor, stroke: c2.strokeColor }
        ];
    }
    return [
        { path: exclusivePath(c1, c2, pts), include: [0], exclude: [1], fill: c1.fillColor, stroke: c1.strokeColor },
        { path: lensPath(c1, c2, pts),      include: [0, 1], exclude: [], fill: blendFills(c1, c2), stroke: '#888' },
        { path: exclusivePath(c2, c1, pts), include: [1], exclude: [0], fill: c2.fillColor, stroke: c2.strokeColor }
    ];
}

/**
 * For 3+ circles, use a sampling approach: generate all 2^n - 1 non-empty
 * boolean subsets, and for each subset build the zone path by clipping arcs.
 *
 * For practical SVG rendering with 3-4 circles, we use a clip-path approach
 * with circle + exclusion regions.  But a simpler robust approach for LWC:
 * render each zone as an SVG path built from arc segments.
 *
 * Given the complexity of computing exact intersection polygons for 3-4 circles,
 * we use a pragmatic approach: render transparent circle fills, then overlay
 * clickable invisible regions computed via the geometric zone decomposition.
 */
function buildZones3(circles) {
    const [c1, c2, c3] = circles;
    const p12 = circleIntersections(c1, c2);
    const p13 = circleIntersections(c1, c3);
    const p23 = circleIntersections(c2, c3);

    // If any pair doesn't intersect, simplify
    if (p12.length < 2 || p13.length < 2 || p23.length < 2) {
        return buildZonesFallback(circles);
    }

    // For 3 circles we compute 7 zones using arc clipping
    // Find the intersection points that form the inner triangle (points inside all 3)
    const innerPts = [];

    // From p12, find points inside c3
    for (const pt of p12) {
        if (insideCircle(pt, c3)) innerPts.push({ pt, circles: [0, 1] });
    }
    for (const pt of p13) {
        if (insideCircle(pt, c2)) innerPts.push({ pt, circles: [0, 2] });
    }
    for (const pt of p23) {
        if (insideCircle(pt, c1)) innerPts.push({ pt, circles: [1, 2] });
    }

    if (innerPts.length < 3) {
        // No triple intersection or incomplete — use fallback
        return buildZonesFallback(circles);
    }

    // Sort inner points by angle around their centroid for consistent path
    const cx = innerPts.reduce((s, p) => s + p.pt.x, 0) / innerPts.length;
    const cy = innerPts.reduce((s, p) => s + p.pt.y, 0) / innerPts.length;
    innerPts.sort((a, b) => Math.atan2(a.pt.y - cy, a.pt.x - cx) -
                            Math.atan2(b.pt.y - cy, b.pt.x - cx));

    const zones = [];

    // Zone ABC (centre) — triangle of arcs
    zones.push(buildTripleZone(circles, innerPts));

    // Pairwise-only zones (AB not C, AC not B, BC not A)
    zones.push(buildPairwiseOnlyZone(circles, 0, 1, 2, p12, innerPts));
    zones.push(buildPairwiseOnlyZone(circles, 0, 2, 1, p13, innerPts));
    zones.push(buildPairwiseOnlyZone(circles, 1, 2, 0, p23, innerPts));

    // Single-only zones (A not B not C, B not A not C, C not A not B)
    zones.push(buildSingleOnlyZone3(circles, 0, [1, 2], p12, p13, innerPts));
    zones.push(buildSingleOnlyZone3(circles, 1, [0, 2], p12, p23, innerPts));
    zones.push(buildSingleOnlyZone3(circles, 2, [0, 1], p13, p23, innerPts));

    return zones;
}

function buildTripleZone(circles, innerPts) {
    // Path from each inner point to the next, using the arc of the shared circle
    let d = '';
    for (let i = 0; i < innerPts.length; i++) {
        const curr = innerPts[i];
        const next = innerPts[(i + 1) % innerPts.length];
        // Find which circle both belong to
        const sharedCircle = findSharedCircle(curr.circles, next.circles);
        const c = circles[sharedCircle];

        if (i === 0) {
            d += `M ${curr.pt.x} ${curr.pt.y} `;
        }
        // Arc along the shared circle — use centre of triple zone as reference
        const centroid = {
            x: innerPts.reduce((s, p) => s + p.pt.x, 0) / innerPts.length,
            y: innerPts.reduce((s, p) => s + p.pt.y, 0) / innerPts.length
        };
        const sweep = arcSweepContaining(c, curr.pt, next.pt, centroid);
        d += `A ${c.r} ${c.r} 0 ${sweep.large} ${sweep.dir} ${next.pt.x} ${next.pt.y} `;
    }
    d += 'Z';

    return {
        path: d,
        include: [0, 1, 2],
        exclude: [],
        fill: 'rgba(150,150,150,0.25)',
        stroke: '#888'
    };
}

function findSharedCircle(circles1, circles2) {
    for (const c of circles1) {
        if (circles2.includes(c)) return c;
    }
    return circles1[0]; // fallback
}

function buildPairwiseOnlyZone(circles, i, j, excluded, pairPts, innerPts) {
    // The zone where member is in circle[i] AND circle[j] but NOT circle[excluded]
    // Bounded by: the pairwise intersection points and the inner (triple) intersection points

    // Get the pairwise intersection points NOT inside the excluded circle
    const outerPts = pairPts.filter(pt => !insideCircle(pt, circles[excluded]));
    // Get the inner points that are on the boundary of circles i and j
    const inner = innerPts.filter(ip =>
        ip.circles.includes(i) && ip.circles.includes(j)
    );

    if (outerPts.length < 1 || inner.length < 1) {
        // Zone doesn't exist or is too small
        return { path: '', include: [i, j], exclude: [excluded], fill: 'transparent', stroke: 'none' };
    }

    // If we have exactly 1 outer point and 1 inner point
    // OR 2 outer and 2 inner — build the path

    // Find the inner point on boundary i-j
    const iPt = inner[0]; // There should be exactly one inner point on this edge

    // For the outer intersection: there may be 1 or 2 points
    // If 2: the zone is bounded by both outer points and the inner point forms a loop
    // If 1: simpler case
    if (outerPts.length >= 2 && inner.length >= 1) {
        // Zone is a lens-like shape bounded by:
        // outer[0] -> arc(ci) -> inner -> arc(cj) -> outer[1] -> arc(ci) back
        // This is complex; use a reference point in the zone
        const refPt = {
            x: (outerPts[0].x + outerPts[1].x + iPt.pt.x) / 3,
            y: (outerPts[0].y + outerPts[1].y + iPt.pt.y) / 3
        };

        // Sort all boundary points by angle around reference
        const allBoundary = [
            { pt: outerPts[0], type: 'outer' },
            { pt: outerPts[1], type: 'outer' },
            { pt: iPt.pt, type: 'inner' }
        ];
        allBoundary.sort((a, b) =>
            Math.atan2(a.pt.y - refPt.y, a.pt.x - refPt.x) -
            Math.atan2(b.pt.y - refPt.y, b.pt.x - refPt.x)
        );

        // Build path — each edge is an arc along the circle that contains both endpoints
        let d = `M ${allBoundary[0].pt.x} ${allBoundary[0].pt.y} `;
        for (let k = 0; k < 3; k++) {
            const curr = allBoundary[k];
            const next = allBoundary[(k + 1) % 3];
            const arcCircle = findArcCircle(circles, i, j, curr, next, pairPts, innerPts);
            const sweep = arcSweepContaining(arcCircle, curr.pt, next.pt, refPt);
            d += `A ${arcCircle.r} ${arcCircle.r} 0 ${sweep.large} ${sweep.dir} ${next.pt.x} ${next.pt.y} `;
        }
        d += 'Z';

        return {
            path: d,
            include: [i, j],
            exclude: [excluded],
            fill: blendFills(circles[i], circles[j]),
            stroke: '#888'
        };
    }

    return { path: '', include: [i, j], exclude: [excluded], fill: 'transparent', stroke: 'none' };
}

function findArcCircle(circles, i, j, ptA, ptB, pairPts, innerPts) {
    // Determine which circle the arc between ptA and ptB lies on
    // Outer points are on both circle i and j
    // Inner points are on two of the three circles
    // The arc between an outer point and inner point lies on either circle i or j
    // The arc between two outer points lies on either circle i or j (the one away from excluded)

    // Simple heuristic: try both circles, pick the one where the arc length is shorter
    const ci = circles[i];
    const cj = circles[j];

    const distI = Math.abs(angle(ci, ptA.pt) - angle(ci, ptB.pt));
    const distJ = Math.abs(angle(cj, ptA.pt) - angle(cj, ptB.pt));

    // Check which circle both points lie on (within tolerance)
    const onI_A = Math.abs(Math.sqrt((ptA.pt.x - ci.x) ** 2 + (ptA.pt.y - ci.y) ** 2) - ci.r) < 1;
    const onI_B = Math.abs(Math.sqrt((ptB.pt.x - ci.x) ** 2 + (ptB.pt.y - ci.y) ** 2) - ci.r) < 1;
    const onJ_A = Math.abs(Math.sqrt((ptA.pt.x - cj.x) ** 2 + (ptA.pt.y - cj.y) ** 2) - cj.r) < 1;
    const onJ_B = Math.abs(Math.sqrt((ptB.pt.x - cj.x) ** 2 + (ptB.pt.y - cj.y) ** 2) - cj.r) < 1;

    if (onI_A && onI_B && !(onJ_A && onJ_B)) return ci;
    if (onJ_A && onJ_B && !(onI_A && onI_B)) return cj;

    // Both on both circles — pick the one with shorter arc
    return distI <= distJ ? ci : cj;
}

function buildSingleOnlyZone3(circles, idx, excludedIdxs, pairPtsA, pairPtsB, innerPts) {
    // Zone: in circle[idx] but NOT in any of excludedIdxs
    // This is the "outer petal" of one circle

    // For simplicity with 3 circles, render as the full circle minus the overlapping areas
    // Use clipPath approach: we'll return the path definition and let the parent handle clipping
    // OR build the path from the boundary arcs

    const c = circles[idx];
    const zones = [];

    // Collect all intersection points on circle[idx] that are relevant
    const allPts = [];

    // Points where circle[idx] intersects circle[excludedIdxs[0]]
    const pts0 = circleIntersections(c, circles[excludedIdxs[0]]);
    const pts0Outside = pts0.filter(pt => !insideCircle(pt, circles[excludedIdxs[1]]));
    for (const pt of pts0Outside) allPts.push({ pt, otherCircle: excludedIdxs[0] });

    // Points where circle[idx] intersects circle[excludedIdxs[1]]
    const pts1 = circleIntersections(c, circles[excludedIdxs[1]]);
    const pts1Outside = pts1.filter(pt => !insideCircle(pt, circles[excludedIdxs[0]]));
    for (const pt of pts1Outside) allPts.push({ pt, otherCircle: excludedIdxs[1] });

    // Inner points on circle[idx] (these are inside both other circles)
    const inner = innerPts.filter(ip => ip.circles.includes(idx));
    for (const ip of inner) allPts.push({ pt: ip.pt, otherCircle: -1 });

    if (allPts.length < 3) {
        // Not enough boundary points — zone is either full circle or empty
        return { path: fullCirclePath(c), include: [idx], exclude: excludedIdxs, fill: c.fillColor, stroke: c.strokeColor };
    }

    // Sort boundary points by angle around circle centre
    allPts.sort((a, b) => angle(c, a.pt) - angle(c, b.pt));

    // The "only" zone is the region on circle[idx] that stays outside both other circles
    // Build path: alternate between arcs on circle[idx] and arcs on the excluding circles

    // Find a reference point clearly inside circle[idx] and outside both others
    const refAngle = findFreeAngle(c, circles[excludedIdxs[0]], circles[excludedIdxs[1]], allPts);
    const refPt = {
        x: c.x + (c.r * 0.7) * Math.cos(refAngle),
        y: c.y + (c.r * 0.7) * Math.sin(refAngle)
    };

    // Build path going around the boundary
    let d = `M ${allPts[0].pt.x} ${allPts[0].pt.y} `;
    for (let k = 0; k < allPts.length; k++) {
        const curr = allPts[k];
        const next = allPts[(k + 1) % allPts.length];

        // Determine which circle this edge lies on
        // If the midpoint of the arc is outside both excluded circles, it's on circle[idx]
        // If it's inside one excluded circle, the edge is on that excluded circle
        const midAngle = (angle(c, curr.pt) + angle(c, next.pt)) / 2;
        const testPt = {
            x: c.x + c.r * Math.cos(midAngle),
            y: c.y + c.r * Math.sin(midAngle)
        };

        // Check if this segment goes through free space (on circle[idx]) or through overlap (on excluded circle)
        const inExcl0 = insideCircle(testPt, circles[excludedIdxs[0]]);
        const inExcl1 = insideCircle(testPt, circles[excludedIdxs[1]]);

        let arcCircle;
        if (!inExcl0 && !inExcl1) {
            // Arc on circle[idx] (the outer boundary)
            arcCircle = c;
        } else if (curr.otherCircle >= 0 && next.otherCircle >= 0 && curr.otherCircle === next.otherCircle) {
            // Both points on same other circle
            arcCircle = circles[curr.otherCircle];
        } else if (curr.otherCircle >= 0) {
            arcCircle = circles[curr.otherCircle];
        } else if (next.otherCircle >= 0) {
            arcCircle = circles[next.otherCircle];
        } else {
            arcCircle = c;
        }

        const sweep = arcSweepContaining(arcCircle, curr.pt, next.pt, refPt);
        d += `A ${arcCircle.r} ${arcCircle.r} 0 ${sweep.large} ${sweep.dir} ${next.pt.x} ${next.pt.y} `;
    }
    d += 'Z';

    return {
        path: d,
        include: [idx],
        exclude: excludedIdxs,
        fill: c.fillColor,
        stroke: c.strokeColor
    };
}

function findFreeAngle(c, excl1, excl2, boundaryPts) {
    // Find an angle on circle c that's outside both excl1 and excl2
    for (let a = 0; a < Math.PI * 2; a += 0.1) {
        const pt = { x: c.x + c.r * 0.7 * Math.cos(a), y: c.y + c.r * 0.7 * Math.sin(a) };
        if (!insideCircle(pt, excl1) && !insideCircle(pt, excl2)) {
            return a;
        }
    }
    return 0;
}

/**
 * Fallback zone builder for complex cases — renders each circle as a full
 * clickable region with the include being that single circle and exclude
 * being all others. Less precise but always works.
 */
function buildZonesFallback(circles) {
    const zones = [];
    const n = circles.length;

    // Generate all 2^n - 1 non-empty subsets
    for (let mask = 1; mask < (1 << n); mask++) {
        const include = [];
        const exclude = [];
        for (let i = 0; i < n; i++) {
            if (mask & (1 << i)) {
                include.push(i);
            } else {
                exclude.push(i);
            }
        }

        // For the fallback, only create single-circle zones
        // (clicking a circle includes it, excludes all others)
        if (include.length === 1) {
            const c = circles[include[0]];
            zones.push({
                path: fullCirclePath(c),
                include,
                exclude,
                fill: c.fillColor,
                stroke: c.strokeColor
            });
        }
    }
    return zones;
}

function buildZones4(circles) {
    // For 4 circles, the zone geometry is extremely complex (15 zones).
    // Use a practical approach: render each circle as a full zone with lower opacity,
    // then compute pairwise and higher-order overlaps where circles intersect.
    // Given LWC constraints, we use the fallback approach for 4 circles
    // which provides clickable regions for each boolean combination.

    // For 4 circles we compute what we can and use fallback for complex zones
    const zones = [];
    const n = 4;

    // Compute all pairwise intersections
    const pairIntersections = {};
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            pairIntersections[`${i}_${j}`] = circleIntersections(circles[i], circles[j]);
        }
    }

    // Check which pairs actually intersect
    const hasOverlap = {};
    for (const key of Object.keys(pairIntersections)) {
        hasOverlap[key] = pairIntersections[key].length >= 2;
    }

    // For 4 circles: build zones similarly to 2-circle approach for each pair
    // Generate all 15 non-empty subsets
    for (let mask = 1; mask < (1 << n); mask++) {
        const include = [];
        const exclude = [];
        for (let i = 0; i < n; i++) {
            if (mask & (1 << i)) {
                include.push(i);
            } else {
                exclude.push(i);
            }
        }

        // Compute a representative point for this zone
        // Start with the centroid of included circles, offset away from excluded circles
        let rx = 0, ry = 0;
        for (const i of include) {
            rx += circles[i].x;
            ry += circles[i].y;
        }
        rx /= include.length;
        ry /= include.length;

        // Check if this point is actually valid (inside all included, outside all excluded)
        const valid = include.every(i => insideCircle({ x: rx, y: ry }, circles[i])) &&
                      exclude.every(i => !insideCircle({ x: rx, y: ry }, circles[i]));

        if (!valid) {
            // Try to find a valid point by sampling
            let found = false;
            for (let dx = -R; dx <= R && !found; dx += 5) {
                for (let dy = -R; dy <= R && !found; dy += 5) {
                    const testPt = { x: rx + dx, y: ry + dy };
                    const allIn = include.every(i => insideCircle(testPt, circles[i]));
                    const noneEx = exclude.every(i => !insideCircle(testPt, circles[i]));
                    if (allIn && noneEx) {
                        rx = testPt.x;
                        ry = testPt.y;
                        found = true;
                    }
                }
            }
            if (!found) continue; // This zone has no area — skip it
        }

        // For single-circle-only zones, use the crescent approach
        // For multi-circle zones, use a small indicator circle at the representative point
        let zonePath;
        let zoneFill;
        let zoneStroke;

        if (include.length === 1 && exclude.length === n - 1) {
            // Single circle only — try to build crescent
            const c = circles[include[0]];
            // Build path by clipping out all other circles
            zonePath = fullCirclePath(c);
            zoneFill = c.fillColor;
            zoneStroke = c.strokeColor;
        } else {
            // Use an indicator circle at the representative point
            const indicatorR = 18;
            zonePath = `M ${rx - indicatorR} ${ry} ` +
                       `A ${indicatorR} ${indicatorR} 0 1 1 ${rx + indicatorR} ${ry} ` +
                       `A ${indicatorR} ${indicatorR} 0 1 1 ${rx - indicatorR} ${ry} Z`;

            if (include.length === n) {
                zoneFill = 'rgba(150,150,150,0.3)';
                zoneStroke = '#888';
            } else {
                zoneFill = blendMultipleFills(include.map(i => circles[i]));
                zoneStroke = '#888';
            }
        }

        zones.push({
            path: zonePath,
            include,
            exclude,
            fill: zoneFill,
            stroke: zoneStroke
        });
    }

    return zones;
}

function blendFills(c1, c2) {
    // Return a blended fill for 2-circle overlap
    return `rgba(150,150,200,0.25)`;
}

function blendMultipleFills(circs) {
    const alpha = 0.15 + circs.length * 0.05;
    return `rgba(150,150,180,${alpha})`;
}

// ─── Component ───────────────────────────────────────────────────────────

export default class VennDiagramSvg extends LightningElement {

    @api
    get segmentsJson() { return this._segmentsJson; }
    set segmentsJson(val) {
        this._segmentsJson = val;
        try {
            this._segments = JSON.parse(val || '[]');
        } catch (e) {
            this._segments = [];
        }
    }

    @api pairwiseJson = '{}';  // pairwise overlap counts from parent

    _segmentsJson = '[]';
    _segments = [];

    get viewBox() { return `0 0 ${W} ${H}`; }

    get hasCircles() {
        const n = this._segments.length;
        return n >= 2 && n <= 4;
    }

    /**
     * Compute circle objects with absolute positions.
     */
    get _circleObjects() {
        const segs = this._segments;
        const n = segs.length;
        if (n < 2 || n > 4) return [];
        const layout = LAYOUTS[n];
        return segs.map((seg, i) => ({
            x: CX + layout[i].x,
            y: CY + layout[i].y,
            r: R,
            fillColor:   seg.fill   || 'rgba(1,118,211,0.15)',
            strokeColor: seg.color  || '#0176D3',
            textFill:    seg.textFill || '#014486',
            name:        seg.name,
            count:       seg.count,
            index:       i
        }));
    }

    /**
     * Background circles (visual only — semi-transparent fills for the base look).
     */
    get circles() {
        const co = this._circleObjects;
        const layout = LAYOUTS[co.length] || [];
        return co.map((c, i) => ({
            key:       `bg-${i}`,
            cx:        c.x,
            cy:        c.y,
            r:         c.r,
            fill:      c.fillColor,
            stroke:    c.strokeColor
        }));
    }

    /**
     * Clickable zone paths.
     */
    get zonePaths() {
        const co = this._circleObjects;
        const n = co.length;
        if (n < 2) return [];

        let zones;
        if (n === 2) zones = buildZones2(co);
        else if (n === 3) zones = buildZones3(co);
        else zones = buildZones4(co);

        return zones
            .filter(z => z.path && z.path.length > 0)
            .map((z, i) => ({
                key:     `zone-${i}`,
                d:       z.path,
                include: JSON.stringify(z.include),
                exclude: JSON.stringify(z.exclude),
                label:   this._zoneLabel(z.include, z.exclude)
            }));
    }

    /**
     * Labels displayed below each circle.
     */
    get circleLabels() {
        const co = this._circleObjects;
        const layout = LAYOUTS[co.length] || [];
        return co.map((c, i) => ({
            key:    `lbl-${i}`,
            x:      c.x,
            y:      c.y + c.r + 22,
            label:  this._truncate(c.name, 22)
        }));
    }

    /**
     * Count labels positioned in the outer part of each circle.
     */
    get circleCountLabels() {
        const co = this._circleObjects;
        const n = co.length;
        const layout = LAYOUTS[n] || [];
        return co.map((c, i) => ({
            key:     `cnt-${i}`,
            x:       this._countX(layout, i, n),
            y:       this._countY(layout, i, n),
            count:   this._fmt(c.count),
            txtFill: c.textFill
        }));
    }

    // ─── Event handling ───────────────────────────────────────────────────

    handleZoneClick(event) {
        const target = event.currentTarget;
        const include = JSON.parse(target.dataset.include);
        const exclude = JSON.parse(target.dataset.exclude);

        this.dispatchEvent(new CustomEvent('zoneclick', {
            detail: { include, exclude },
            bubbles: true,
            composed: true
        }));
    }

    // ─── Helpers ──────────────────────────────────────────────────────────

    _zoneLabel(include, exclude) {
        const segs = this._segments;
        const incNames = include.map(i => segs[i]?.name || `Segment ${i + 1}`);
        if (exclude.length === 0) {
            return incNames.join(' ∩ ');
        }
        return incNames.join(' ∩ ') + ' only';
    }

    _countX(layout, i, n) {
        const pos = layout[i];
        if (n === 2) {
            return CX + pos.x + (i === 0 ? -32 : 32);
        }
        const dx = pos.x === 0 ? 0 : (pos.x > 0 ? 30 : -30);
        return CX + pos.x + dx;
    }

    _countY(layout, i, n) {
        const pos = layout[i];
        if (n === 2) return CY + pos.y;
        const dy = pos.y > 0 ? 24 : -24;
        return CY + pos.y + dy;
    }

    _fmt(n) {
        const num = Number(n) || 0;
        if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
        if (num >= 1_000)     return (num / 1_000).toFixed(1) + 'K';
        return String(num);
    }

    _truncate(s, max = 22) {
        if (!s) return '';
        return s.length > max ? s.slice(0, max - 1) + '…' : s;
    }
}
