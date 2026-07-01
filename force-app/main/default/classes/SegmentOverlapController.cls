/**
 * AuraEnabled controller for the Segment Overlap LWC.
 * Thin wrapper around DataCloudService.
 */
public with sharing class SegmentOverlapController {

    @AuraEnabled(cacheable=true)
    public static List<Map<String, Object>> getSegments() {
        try {
            return DataCloudService.getPublishedSegments();
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /**
     * Multi-segment overlap (2–4 segments).
     */
    @AuraEnabled
    public static Map<String, Object> calculateMultiOverlap(
        List<String> segmentIds
    ) {
        try {
            return DataCloudService.calculateMultiOverlap(segmentIds);
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /**
     * Legacy 2-segment overlap — kept for backward compatibility.
     */
    @AuraEnabled
    public static Map<String, Object> calculateOverlap(
        String segIdA, String segIdB, Long countA, Long countB
    ) {
        try {
            return DataCloudService.calculateOverlap(
                segIdA, segIdB, countA, countB
            );
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /**
     * Create a new segment from the overlap of 2–4 existing segments.
     */
    @AuraEnabled
    public static Map<String, Object> createSegmentFromOverlap(
        List<String> segmentIds,
        String segmentName
    ) {
        try {
            return DataCloudService.createSegmentFromOverlap(
                segmentIds, segmentName
            );
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    /**
     * Create a new segment from a specific Venn zone (include/exclude logic).
     */
    @AuraEnabled
    public static Map<String, Object> createSegmentFromZone(
        List<String> includeIds,
        List<String> excludeIds,
        String segmentName
    ) {
        try {
            return DataCloudService.createSegmentFromZone(
                includeIds, excludeIds, segmentName
            );
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }
}