import { Connection } from "mongoose";
import { seedBallot, seedCase } from "../seed-helpers";

export async function seedAttestation(
  conn: Connection, electionId: string,
  departmentName: string,
  municipalityName: string,
  votes: { [party: string]: number }
) {
  const department = await conn.collection('departments').findOne({ name: departmentName });
  if (!department) {
    throw new Error(`Department ${departmentName} not found`);
  }

  const municipality = await conn.collection('municipalities').findOne({ name: municipalityName });
  if (!municipality) {
    throw new Error(`Municipality ${municipalityName} not found`);
  }

  const province = await conn.collection('provinces').findOne({ _id: municipality.provinceId, departmentId: department._id });
  if (!province) {
    throw new Error(`Province for department ${departmentName} and municipality ${municipalityName} not found`);
  }

  const seat = await conn.collection('electoral_seats').findOne({ municipalityId: municipality._id });
  if (!seat) {
    throw new Error(`Electoral seat for municipality ${municipalityName} not found`);
  }

  const location = await conn.collection('electoral_locations').findOne({ electoralSeatId: seat._id });
  if (!location) {
    throw new Error(`Electoral location for seat ${seat.name} not found`);
  }

  const table = await conn.collection('electoral_tables').findOne({ electoralLocationId: location._id });
  if (!table) {
    throw new Error(`Electoral table for location ${location.name} not found`);
  }

  const ballot = await seedBallot(conn, {
    electionId: electionId, tableCode: table.tableCode, version: 1, valuable: true,
    status: 'processed',
    loc: {
      department: department.name,
      province: province.name,
      municipality: municipality.name,
      seat: seat.name,
      location: location.name,
      district: location.district,
      zone: location.zone,
      circ: {
        number: location.circunscripcion.number,
        type: location.circunscripcion.type,
        name: location.circunscripcion.name
      } },
    parties: { valid: Object.values(votes).reduce((a, b) => a + b, 0), null: 5, blank: 5, votes: votes }
  });

  const attestation = await conn.collection('attestations').insertOne({
    support: true,
    electionId: electionId,
    ballotId: ballot._id,
    isJury: false,
  });

  await seedCase(conn, {
    electionId: electionId, tableCode: table.tableCode,
    status: 'CONSENSUAL', winningBallotId: ballot._id
  });

  return { ballot, attestation };
}