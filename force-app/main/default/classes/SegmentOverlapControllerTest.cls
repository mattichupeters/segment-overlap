@IsTest
private class SegmentOverlapControllerTest {

    @IsTest
    static void getSegments_surfacesError() {
        try {
            Test.startTest();
            SegmentOverlapController.getSegments();
            Test.stopTest();
        } catch (AuraHandledException e) {
            System.assertNotEquals(null, e.getMessage());
        }
    }

    @IsTest
    static void calculateMultiOverlap_surfacesError() {
        try {
            Test.startTest();
            SegmentOverlapController.calculateMultiOverlap(
                new List<String>{ 'seg001', 'seg002' }
            );
            Test.stopTest();
            System.assert(false, 'Expected exception');
        } catch (AuraHandledException e) {
            System.assertNotEquals(null, e.getMessage());
        }
    }

    @IsTest
    static void calculateOverlap_surfacesError() {
        try {
            Test.startTest();
            SegmentOverlapController.calculateOverlap(
                'seg001', 'seg002', 1000L, 800L
            );
            Test.stopTest();
            System.assert(false, 'Expected exception');
        } catch (AuraHandledException e) {
            System.assertNotEquals(null, e.getMessage());
        }
    }

    @IsTest
    static void createSegmentFromOverlap_surfacesError() {
        try {
            Test.startTest();
            SegmentOverlapController.createSegmentFromOverlap(
                new List<String>{ 'seg001', 'seg002' },
                'Test Overlap Segment'
            );
            Test.stopTest();
            System.assert(false, 'Expected exception');
        } catch (AuraHandledException e) {
            System.assertNotEquals(null, e.getMessage());
        }
    }

    @IsTest
    static void createSegmentFromOverlap_validatesEmptyName() {
        try {
            Test.startTest();
            SegmentOverlapController.createSegmentFromOverlap(
                new List<String>{ 'seg001', 'seg002' },
                ''
            );
            Test.stopTest();
            System.assert(false, 'Expected exception');
        } catch (AuraHandledException e) {
            System.assertNotEquals(null, e.getMessage(),
                'Should throw for empty segment name');
        }
    }

    @IsTest
    static void createSegmentFromOverlap_validatesSegmentCount() {
        try {
            Test.startTest();
            SegmentOverlapController.createSegmentFromOverlap(
                new List<String>{ 'seg001' },
                'Test Segment'
            );
            Test.stopTest();
            System.assert(false, 'Expected exception');
        } catch (AuraHandledException e) {
            System.assertNotEquals(null, e.getMessage(),
                'Should throw for insufficient segments');
        }
    }

    // ── createSegmentFromZone tests ─────────────────────────────────────────

    @IsTest
    static void createSegmentFromZone_surfacesError() {
        try {
            Test.startTest();
            SegmentOverlapController.createSegmentFromZone(
                new List<String>{ 'seg001' },
                new List<String>{ 'seg002' },
                'Test Zone Segment'
            );
            Test.stopTest();
            System.assert(false, 'Expected exception');
        } catch (AuraHandledException e) {
            System.assertNotEquals(null, e.getMessage());
        }
    }

    @IsTest
    static void createSegmentFromZone_validatesEmptyName() {
        try {
            Test.startTest();
            SegmentOverlapController.createSegmentFromZone(
                new List<String>{ 'seg001' },
                new List<String>{ 'seg002' },
                ''
            );
            Test.stopTest();
            System.assert(false, 'Expected exception');
        } catch (AuraHandledException e) {
            System.assertNotEquals(null, e.getMessage(),
                'Should throw for empty segment name');
        }
    }

    @IsTest
    static void createSegmentFromZone_validatesEmptyInclude() {
        try {
            Test.startTest();
            SegmentOverlapController.createSegmentFromZone(
                new List<String>(),
                new List<String>{ 'seg001', 'seg002' },
                'Test Segment'
            );
            Test.stopTest();
            System.assert(false, 'Expected exception');
        } catch (AuraHandledException e) {
            System.assertNotEquals(null, e.getMessage(),
                'Should throw for empty include list');
        }
    }

    @IsTest
    static void createSegmentFromZone_validatesTotalCount() {
        try {
            Test.startTest();
            SegmentOverlapController.createSegmentFromZone(
                new List<String>{ 'seg001' },
                new List<String>(),
                'Test Segment'
            );
            Test.stopTest();
            System.assert(false, 'Expected exception');
        } catch (AuraHandledException e) {
            System.assertNotEquals(null, e.getMessage(),
                'Should throw for total count < 2');
        }
    }
}
