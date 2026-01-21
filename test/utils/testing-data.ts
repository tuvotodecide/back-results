export const testUser = {
  "dni": "491852378",
  "email": "user@example.com",
  "name": "Jane Doe",
  "password": "secret123",
  "votingDepartmentId": "6794f4c6aa52f60011d54cd9",
}

export const testDelegatesCsv = `dni,name,phone,email
12345678,Delegate One,73645634,delegate1@mail.com
87654321,Delegate Two,35462342,delegate2@mail.com
`;

export const testDelegatesCsv2 = `dni,name,phone,email
11223344,Delegate Three,98765432,delegate3@mail.com
44332211,Delegate Four,12345678,delegate4@mail.com
`;

export const testDelegateObject = {
  "dni": "2431523",
  "contractId": "",
  "name": "Delegate Object",
  "phone": "478394845",
  "email": "delegate.object@example.com"
}

export const testActiveContract = {
  "clientId": "",
  "electionId": "",
  "startDate": new Date(new Date().setDate(new Date().getDate() - 1)),
  "endDate": new Date(new Date().setDate(new Date().getDate() + 1))
}