/**
 * Queries Data Cloud segments and membership data.
 *
 * getPublishedSegments() — MarketSegment sObject + ConnectApi for API names.
 * calculateMultiOverlap() — Supports 2–4 segments, returns pairwise +
 *   full intersection counts using the latest membership DMO table.
 */
public with sharing class DataCloudService {

    /**
     * Returns all published/active segments.
     */
    public static List<Map<String, Object>> getPublishedSegments() {
        try {
            List<MarketSegment> rows = [
                SELECT Id, Name, LastSegmentMemberCount
                FROM MarketSegment
                WHERE SegmentStatus = 'ACTIVE'
                ORDER BY Name ASC
                LIMIT 500
            ];

            Map<String, String> idToApiName = new Map<String, String>();
            try {
                ConnectApi.CdpSegmentContainerOutput container =
                    ConnectApi.CdpSegment.getSegments();
                if (container.segments != null) {
                    for (ConnectApi.CdpSegmentOutput seg : container.segments) {
                        idToApiName.put(seg.marketSegmentId, seg.apiName);
                    }
                }
            } catch (Exception e) {
                for (MarketSegment row : rows) {
                    idToApiName.put(
                        String.valueOf(row.Id),
                        row.Name.replaceAll('[^a-zA-Z0-9_]', '_')
                    );
                }
            }

            List<Map<String, Object>> result = new List<Map<String, Object>>();
            for (MarketSegment row : rows) {
                String sfId = String.valueOf(row.Id);
                result.add(new Map<String, Object>{
                    'id'      => sfId,
                    'name'    => row.Name,
                    'count'   => row.LastSegmentMemberCount != null
                                     ? (Long) row.LastSegmentMemberCount : 0L,
                    'apiName' => idToApiName.containsKey(sfId)
                                     ? idToApiName.get(sfId) : sfId
                });
            }
            return result;
        } catch (Exception e) {
            throw new DataCloudException(
                'Segment query failed: ' + e.getMessage()
            );
        }
    }

    /**
     * Calculates overlap between 2–4 segments.
     *
     * @param segmentIds  List of 2–4 Salesforce MarketSegment IDs (18-char)
     * @return Map with keys:
     *   - "segments": List<Map> with id, count, memberCount for each segment
     *   - "pairwise": Map<String, Long> — key = "i_j", value = pairwise overlap
     *   - "allOverlap": Long — count of members in ALL selected segments
     */
    public static Map<String, Object> calculateMultiOverlap(
        List<String> segmentIds
    ) {
        if (segmentIds == null || segmentIds.size() < 2 || segmentIds.size() > 4) {
            throw new DataCloudException('Please select 2 to 4 segments.');
        }

        // Discover the latest membership table
        String latestTable = discoverLatestTable(segmentIds);
        if (String.isBlank(latestTable)) {
            throw new DataCloudException(
                'No membership table found. Ensure at least one segment ' +
                'has been published.'
            );
        }

        // Collect member sets for each segment
        List<Set<String>> memberSets = new List<Set<String>>();
        List<Map<String, Object>> segInfos = new List<Map<String, Object>>();

        for (Integer i = 0; i < segmentIds.size(); i++) {
            String sfId = segmentIds[i];
            String id15 = sfId.length() > 15 ? sfId.substring(0, 15) : sfId;
            Set<String> members = queryMemberIds(latestTable, id15);
            memberSets.add(members);
            segInfos.add(new Map<String, Object>{
                'id'          => sfId,
                'index'       => i,
                'memberCount' => (Long) members.size()
            });
        }

        // Compute pairwise overlaps
        Map<String, Long> pairwise = new Map<String, Long>();
        for (Integer i = 0; i < memberSets.size(); i++) {
            for (Integer j = i + 1; j < memberSets.size(); j++) {
                Long count = countIntersection(memberSets[i], memberSets[j]);
                pairwise.put(i + '_' + j, count);
            }
        }

        // Compute full intersection (members in ALL segments)
        Set<String> allIntersection = new Set<String>(memberSets[0]);
        for (Integer i = 1; i < memberSets.size(); i++) {
            allIntersection.retainAll(memberSets[i]);
        }

        return new Map<String, Object>{
            'segments'   => segInfos,
            'pairwise'   => pairwise,
            'allOverlap' => (Long) allIntersection.size()
        };
    }

    // Keep backward compatibility for existing 2-segment calls
    public static Map<String, Object> calculateOverlap(
        String segIdA, String segIdB, Long countA, Long countB
    ) {
        Map<String, Object> result = calculateMultiOverlap(
            new List<String>{ segIdA, segIdB }
        );
        Map<String, Long> pw = (Map<String, Long>) result.get('pairwise');
        return new Map<String, Object>{
            'countA'  => countA,
            'countB'  => countB,
            'overlap' => pw.get('0_1')
        };
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private static String discoverLatestTable(List<String> segmentIds) {
        Map<String, String> apiNames = getApiNameMap();
        for (String sfId : segmentIds) {
            String apiName = apiNames.get(sfId);
            if (String.isNotBlank(apiName)) {
                String table = getLatestTable(apiName);
                if (String.isNotBlank(table)) return table;
            }
        }
        return null;
    }

    private static Map<String, String> getApiNameMap() {
        Map<String, String> m = new Map<String, String>();
        try {
            ConnectApi.CdpSegmentContainerOutput container =
                ConnectApi.CdpSegment.getSegments();
            if (container.segments != null) {
                for (ConnectApi.CdpSegmentOutput seg : container.segments) {
                    m.put(seg.marketSegmentId, seg.apiName);
                }
            }
        } catch (Exception e) {
            // Swallow
        }
        return m;
    }

    private static String getLatestTable(String segmentApiName) {
        try {
            ConnectApi.CdpSegmentContainerOutput container =
                ConnectApi.CdpSegment.getSegment(segmentApiName);
            if (container.segments != null && !container.segments.isEmpty()) {
                ConnectApi.CdpSegmentOutput seg = container.segments[0];
                String segJson = JSON.serialize(seg);
                Map<String, Object> segMap =
                    (Map<String, Object>) JSON.deserializeUntyped(segJson);
                Map<String, Object> dmo =
                    (Map<String, Object>) segMap.get('segmentMembershipDmo');
                if (dmo != null && dmo.containsKey('latestTable')) {
                    return (String) dmo.get('latestTable');
                }
            }
        } catch (Exception e) {
            // Swallow
        }
        return null;
    }

    private static Set<String> queryMemberIds(
        String latestTable, String segmentId15
    ) {
        Set<String> ids = new Set<String>();
        try {
            String sql =
                'SELECT Id__c FROM ' + latestTable +
                ' WHERE Segment_Id__c = \'' +
                String.escapeSingleQuotes(segmentId15) + '\'' +
                ' LIMIT 50000';

            ConnectApi.CdpQueryInput input = new ConnectApi.CdpQueryInput();
            input.sql = sql;
            ConnectApi.CdpQueryOutputV2 output =
                ConnectApi.CdpQuery.queryAnsiSqlV2(input);

            if (output.data != null) {
                for (Object rowObj : output.data) {
                    ConnectApi.CdpQueryV2Row row =
                        (ConnectApi.CdpQueryV2Row) rowObj;
                    if (row.rowData != null && !row.rowData.isEmpty()
                        && row.rowData[0] != null) {
                        ids.add(String.valueOf(row.rowData[0]));
                    }
                }
            }
        } catch (Exception e) {
            throw new DataCloudException(
                'Membership query failed for segment ' + segmentId15 +
                ' on table ' + latestTable + ': ' + e.getMessage()
            );
        }
        return ids;
    }

    private static Long countIntersection(Set<String> a, Set<String> b) {
        // Iterate over the smaller set for efficiency
        Set<String> smaller = a.size() <= b.size() ? a : b;
        Set<String> larger  = a.size() <= b.size() ? b : a;
        Long count = 0;
        for (String val : smaller) {
            if (larger.contains(val)) count++;
        }
        return count;
    }

    // ── Segment creation ─────────────────────────────────────────────────────

    /**
     * Creates a new Data Cloud segment (DBT type) containing only
     * members that appear in ALL of the supplied segments.
     *
     * @param segmentIds   List of 2–4 MarketSegment IDs whose overlap to capture
     * @param segmentName  User-chosen display name for the new segment
     * @return Map with keys: apiName, marketSegmentId, segmentStatus, displayName
     */
    public static Map<String, Object> createSegmentFromOverlap(
        List<String> segmentIds,
        String segmentName
    ) {
        if (segmentIds == null || segmentIds.size() < 2 || segmentIds.size() > 4) {
            throw new DataCloudException('Please select 2 to 4 segments.');
        }
        if (String.isBlank(segmentName)) {
            throw new DataCloudException('Please provide a segment name.');
        }

        // Discover membership table
        String latestTable = discoverLatestTable(segmentIds);
        if (String.isBlank(latestTable)) {
            throw new DataCloudException(
                'No membership table found. Ensure at least one segment ' +
                'has been published.'
            );
        }

        // Build a developer name that satisfies Salesforce rules:
        //   - Only alphanumeric + underscores
        //   - Must start with a letter
        //   - No consecutive underscores, no trailing underscore
        //   - Must be unique
        String devName = segmentName.replaceAll('[^a-zA-Z0-9]', '_')
                                     .replaceAll('_+', '_')
                                     .removeEnd('_')
                                     .removeStart('_');
        // Ensure it starts with a letter
        if (String.isBlank(devName) || !devName.substring(0, 1).isAlpha()) {
            devName = 'Seg_' + devName;
        }
        // Append a short unique suffix (letter prefix + timestamp last 8 digits)
        String ts = String.valueOf(Datetime.now().getTime());
        String suffix = '_x' + ts.substring(ts.length() - 8);
        Integer maxBase = 80 - suffix.length();
        if (devName.length() > maxBase) {
            devName = devName.substring(0, maxBase);
        }
        // Clean up: remove any trailing underscore before appending suffix
        devName = devName.removeEnd('_') + suffix;

        // Convert 18-char IDs to 15-char for the membership table queries
        List<String> ids15 = new List<String>();
        for (String sfId : segmentIds) {
            ids15.add(sfId.length() > 15 ? sfId.substring(0, 15) : sfId);
        }

        // Build SQL: SELECT members present in ALL segments.
        // Must project both Id__c (primary key) and KQ_Id__c (key qualifier)
        // as required by Data Cloud DBT segment engine.
        // Use nested WHERE IN sub-selects to find intersection across segments.
        String tbl = latestTable;

        // Start with base query for first segment — projects both required columns
        String overlapSql =
            'SELECT DISTINCT ' + tbl + '.Id__c, ' + tbl + '.KQ_Id__c' +
            ' FROM ' + tbl +
            ' WHERE ' + tbl + '.Segment_Id__c = \'' +
            String.escapeSingleQuotes(ids15[0]) + '\'' +
            ' AND ' + tbl + '.Id__c IS NOT NULL';

        // Add WHERE IN clauses for each additional segment
        for (Integer i = 1; i < ids15.size(); i++) {
            overlapSql += ' AND ' + tbl + '.Id__c IN (' +
                'SELECT ' + tbl + '.Id__c FROM ' + tbl +
                ' WHERE ' + tbl + '.Segment_Id__c = \'' +
                String.escapeSingleQuotes(ids15[i]) + '\')';
        }

        // Create the DBT segment via ConnectApi
        ConnectApi.CdpSegmentInput segInput = new ConnectApi.CdpSegmentInput();
        segInput.description = 'Overlap segment created from ' +
            segmentIds.size() + ' segments via Segment Overlap tool.';
        segInput.displayName = segmentName;
        segInput.developerName = devName;
        segInput.segmentOnApiName = 'ssot__Individual__dlm';
        segInput.segmentType = ConnectApi.SegmentType.Dbt;

        ConnectApi.CdpSegmentDbtModelInput model =
            new ConnectApi.CdpSegmentDbtModelInput();
        model.name = devName;   // Must match developerName exactly
        model.sql  = overlapSql;

        ConnectApi.CdpSegmentDbtInput dbtInput =
            new ConnectApi.CdpSegmentDbtInput();
        dbtInput.models =
            new List<ConnectApi.CdpSegmentDbtModelInput>{ model };
        segInput.includeDbt = dbtInput;

        ConnectApi.CdpSegmentOutput result =
            ConnectApi.CdpSegment.createSegment(segInput);

        return new Map<String, Object>{
            'apiName'         => result.apiName,
            'marketSegmentId' => result.marketSegmentId,
            'segmentStatus'   => String.valueOf(result.segmentStatus),
            'displayName'     => segmentName
        };
    }

    // ── Zone-based segment creation ──────────────────────────────────────────

    /**
     * Creates a new Data Cloud segment (DBT type) from a specific Venn zone.
     * Members must be in ALL "include" segments and NONE of the "exclude" segments.
     *
     * @param includeIds  Segment IDs the member MUST belong to (1–4)
     * @param excludeIds  Segment IDs the member must NOT belong to (0–3)
     * @param segmentName User-chosen display name for the new segment
     * @return Map with keys: apiName, marketSegmentId, segmentStatus, displayName
     */
    public static Map<String, Object> createSegmentFromZone(
        List<String> includeIds,
        List<String> excludeIds,
        String segmentName
    ) {
        if (includeIds == null || includeIds.isEmpty()) {
            throw new DataCloudException('At least one included segment is required.');
        }
        if (excludeIds == null) {
            excludeIds = new List<String>();
        }
        Integer total = includeIds.size() + excludeIds.size();
        if (total < 2 || total > 4) {
            throw new DataCloudException('Total segments must be between 2 and 4.');
        }
        if (String.isBlank(segmentName)) {
            throw new DataCloudException('Please provide a segment name.');
        }

        // Combine all IDs to discover the membership table
        List<String> allIds = new List<String>();
        allIds.addAll(includeIds);
        allIds.addAll(excludeIds);

        String latestTable = discoverLatestTable(allIds);
        if (String.isBlank(latestTable)) {
            throw new DataCloudException(
                'No membership table found. Ensure at least one segment ' +
                'has been published.'
            );
        }

        // Build developer name (same pattern as createSegmentFromOverlap)
        String devName = segmentName.replaceAll('[^a-zA-Z0-9]', '_')
                                     .replaceAll('_+', '_')
                                     .removeEnd('_')
                                     .removeStart('_');
        if (String.isBlank(devName) || !devName.substring(0, 1).isAlpha()) {
            devName = 'Seg_' + devName;
        }
        String ts = String.valueOf(Datetime.now().getTime());
        String suffix = '_x' + ts.substring(ts.length() - 8);
        Integer maxBase = 80 - suffix.length();
        if (devName.length() > maxBase) {
            devName = devName.substring(0, maxBase);
        }
        devName = devName.removeEnd('_') + suffix;

        // Convert to 15-char IDs
        List<String> inc15 = new List<String>();
        for (String sfId : includeIds) {
            inc15.add(sfId.length() > 15 ? sfId.substring(0, 15) : sfId);
        }
        List<String> exc15 = new List<String>();
        for (String sfId : excludeIds) {
            exc15.add(sfId.length() > 15 ? sfId.substring(0, 15) : sfId);
        }

        // Build SQL: members in ALL included segments, NOT in ANY excluded segment
        String tbl = latestTable;

        // Base query — first included segment
        String zoneSql =
            'SELECT DISTINCT ' + tbl + '.Id__c, ' + tbl + '.KQ_Id__c' +
            ' FROM ' + tbl +
            ' WHERE ' + tbl + '.Segment_Id__c = \'' +
            String.escapeSingleQuotes(inc15[0]) + '\'' +
            ' AND ' + tbl + '.Id__c IS NOT NULL';

        // Add WHERE IN for additional included segments
        for (Integer i = 1; i < inc15.size(); i++) {
            zoneSql += ' AND ' + tbl + '.Id__c IN (' +
                'SELECT ' + tbl + '.Id__c FROM ' + tbl +
                ' WHERE ' + tbl + '.Segment_Id__c = \'' +
                String.escapeSingleQuotes(inc15[i]) + '\')';
        }

        // Add WHERE NOT IN for each excluded segment
        for (Integer i = 0; i < exc15.size(); i++) {
            zoneSql += ' AND ' + tbl + '.Id__c NOT IN (' +
                'SELECT ' + tbl + '.Id__c FROM ' + tbl +
                ' WHERE ' + tbl + '.Segment_Id__c = \'' +
                String.escapeSingleQuotes(exc15[i]) + '\')';
        }

        // Create the DBT segment via ConnectApi
        ConnectApi.CdpSegmentInput segInput = new ConnectApi.CdpSegmentInput();
        segInput.description = 'Zone segment: include ' + includeIds.size() +
            ', exclude ' + excludeIds.size() +
            ' segments via Segment Overlap tool.';
        segInput.displayName = segmentName;
        segInput.developerName = devName;
        segInput.segmentOnApiName = 'ssot__Individual__dlm';
        segInput.segmentType = ConnectApi.SegmentType.Dbt;

        ConnectApi.CdpSegmentDbtModelInput model =
            new ConnectApi.CdpSegmentDbtModelInput();
        model.name = devName;
        model.sql  = zoneSql;

        ConnectApi.CdpSegmentDbtInput dbtInput =
            new ConnectApi.CdpSegmentDbtInput();
        dbtInput.models =
            new List<ConnectApi.CdpSegmentDbtModelInput>{ model };
        segInput.includeDbt = dbtInput;

        ConnectApi.CdpSegmentOutput result =
            ConnectApi.CdpSegment.createSegment(segInput);

        return new Map<String, Object>{
            'apiName'         => result.apiName,
            'marketSegmentId' => result.marketSegmentId,
            'segmentStatus'   => String.valueOf(result.segmentStatus),
            'displayName'     => segmentName
        };
    }

    public class DataCloudException extends Exception {}
}