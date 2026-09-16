import { RoleName } from '@prisma/client';
import { StudentRecordCompletenessService } from './student-record-completeness.service';

describe('StudentRecordCompletenessService', () => {
  const makeService = (student: any) => {
    const prisma = { student: { findUnique: jest.fn().mockResolvedValue(student) } } as any;
    return { service: new StudentRecordCompletenessService(prisma), prisma };
  };

  it('blocks a record without a primary guardian and admission number', async () => {
    const { service } = makeService({
      id: 'student-1', firstName: 'Ama', lastName: 'Mensah', dateOfBirth: new Date(), admissionNumber: null,
      passportPhotoUrl: null, previousSchool: 'Basic School', hometown: 'Accra', region: 'Greater Accra', status: 'ACTIVE',
      guardians: [{ isPrimaryContact: false, relationship: 'Aunt', canViewAcademic: true, canPayFees: true, canManageWallet: true, guardian: { personId: 'g1', userId: 'u1', preferredSms: true, preferredPush: true, person: { firstName: 'Esi', lastName: 'Mensah', phone: '0240000000', email: null } } }],
      documents: [], enrolments: [{ id: 'e1', level: 'SHS1', programme: 'BUSINESS', class: { id: 'c1', name: 'Business A', level: 'SHS1', programme: 'BUSINESS' }, term: { id: 't1', code: 'T1', name: 'First Term', status: 'OPEN' } }],
      application: null, wallet: null,
    });

    const result = await service.getStudentCompleteness('student-1', [RoleName.OFFICE]);
    const codes = result.findings.map((finding) => finding.code);
    expect(result.readyForCompleteRecord).toBe(false);
    expect(codes).toContain('ADMISSION_NUMBER_MISSING');
    expect(codes).toContain('PRIMARY_GUARDIAN_MISSING');
    expect(codes).toContain('EMERGENCY_CONTACT_SCHEMA_GAP');
  });

  it('marks a complete core record ready while retaining schema-gap warning', async () => {
    const { service } = makeService({
      id: 'student-2', firstName: 'Kojo', lastName: 'Owusu', dateOfBirth: new Date(), admissionNumber: 'BCI-001',
      passportPhotoUrl: 'https://example.test/photo.jpg', previousSchool: 'JHS School', hometown: 'Kumasi', region: 'Ashanti', status: 'ACTIVE',
      guardians: [{ isPrimaryContact: true, relationship: 'Father', canViewAcademic: true, canPayFees: true, canManageWallet: true, guardian: { personId: 'g2', userId: 'u2', preferredSms: true, preferredPush: true, person: { firstName: 'Kofi', lastName: 'Owusu', phone: '0200000000', email: 'kofi@example.test' } } }],
      documents: [{ id: 'd1', type: 'BIRTH_CERTIFICATE', createdAt: new Date() }],
      enrolments: [{ id: 'e2', level: 'SHS2', programme: 'GENERAL_ARTS', class: { id: 'c2', name: 'Arts B', level: 'SHS2', programme: 'GENERAL_ARTS' }, term: { id: 't2', code: 'T2', name: 'Second Term', status: 'OPEN' } }],
      application: null, wallet: { studentId: 'student-2' },
    });

    const result = await service.getStudentCompleteness('student-2', [RoleName.DIRECTOR]);
    expect(result.readyForCompleteRecord).toBe(true);
    expect(result.score).toBe(100);
    expect(result.findings.some((finding) => finding.code === 'EMERGENCY_CONTACT_SCHEMA_GAP')).toBe(true);
  });
});
