import { Contract } from "@/modules/contracts/schemas/contract.schema";
import { Delegate } from "@/modules/contracts/schemas/delegate.schema";
import { User } from "@/modules/users/schemas/user.schema";
import { Connection, Types } from "mongoose";

const delegatesSeed = [
  { dni: '345345345', name: 'Delegate Seed One', phone: '73645634', email: 'delegate.seed1@mail.com' },
  { dni: '243342432', name: 'Delegate Seed Two', phone: '35462342', email: 'delegate.seed2@mail.com' },
  { dni: '453763475', name: 'Delegate Seed Three', phone: '12345678', email: 'delegate.seed3@mail.com' }
];

export async function seedDelegates(conn: Connection, contractId: Types.ObjectId) {
	const contract = await conn.collection<Contract>('contracts').findOne({ _id: contractId });
	if (!contract) {
		throw new Error(`Contract with ID ${contractId} not found for seeding delegates.`);
	}

	const users = await conn.collection<User>('users').insertMany(
		delegatesSeed.map(delegate => ({
			dni: delegate.dni,
			active: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);

  const delegateIds = await conn.collection<Delegate>('delegates').insertMany(
		delegatesSeed.map((delegate, index) => ({
			...delegate,
			userId: users.insertedIds[index],
			active: true,
			createdAt: new Date(),
			updatedAt: new Date(),
			authorizedContracts: [
				{
					contractId,
					addedAt: new Date(),
					clientId: users.insertedIds[index],
					clientRole: contract.clientRole,
					addedBy: users.insertedIds[index],
				}
			],
		})),
	);

	return await conn.collection<Delegate>('delegates').find({ _id: { $in: Object.values(delegateIds.insertedIds) } }).toArray();
}