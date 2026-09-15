import type { BoardProfile, ProductProfile, VoiceProfile } from "@dongxin/shared";
import { BoardProfileSchema, ProductProfileSchema, VoiceProfileSchema } from "@dongxin/shared";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../storage.js";

export async function listProductProfiles(): Promise<ProductProfile[]> {
  const profiles = await readJsonFile<ProductProfile[]>(
    "product-profiles.json",
    [],
  );
  return z.array(ProductProfileSchema).parse(profiles);
}

export async function getProductProfile(
  profileId: string,
): Promise<ProductProfile | null> {
  const profiles = await listProductProfiles();
  return profiles.find((profile) => profile.id === profileId) ?? null;
}

export async function findProductProfileByDeviceModel(
  model: string,
): Promise<ProductProfile | null> {
  const profiles = await listProductProfiles();
  return (
    profiles.find(
      (profile) =>
        profile.model === model || profile.deviceModelAliases.includes(model),
    ) ?? null
  );
}

export async function saveProductProfile(
  profile: ProductProfile,
): Promise<ProductProfile> {
  const parsed = ProductProfileSchema.parse(profile);
  const profiles = await listProductProfiles();
  const index = profiles.findIndex((item) => item.id === parsed.id);
  const nextProfiles = [...profiles];
  if (index >= 0) {
    nextProfiles[index] = parsed;
  } else {
    nextProfiles.push(parsed);
  }
  await writeJsonFile("product-profiles.json", nextProfiles);
  return parsed;
}

export async function listVoiceProfiles(): Promise<VoiceProfile[]> {
  const profiles = await readJsonFile<VoiceProfile[]>(
    "voice-profiles.json",
    [],
  );
  return z.array(VoiceProfileSchema).parse(profiles);
}

export async function getVoiceProfile(
  profileId: string,
): Promise<VoiceProfile | null> {
  const profiles = await listVoiceProfiles();
  return profiles.find((profile) => profile.id === profileId) ?? null;
}

export async function saveVoiceProfile(
  profile: VoiceProfile,
): Promise<VoiceProfile> {
  const parsed = VoiceProfileSchema.parse(profile);
  const profiles = await listVoiceProfiles();
  const index = profiles.findIndex((item) => item.id === parsed.id);
  const nextProfiles = [...profiles];
  if (index >= 0) {
    nextProfiles[index] = parsed;
  } else {
    nextProfiles.push(parsed);
  }
  await writeJsonFile("voice-profiles.json", nextProfiles);
  return parsed;
}

export async function listBoardProfiles(): Promise<BoardProfile[]> {
  const profiles = await readJsonFile<BoardProfile[]>("board-profiles.json", []);
  return z.array(BoardProfileSchema).parse(profiles);
}

export async function getBoardProfile(
  boardProfileId: string,
): Promise<BoardProfile | null> {
  const profiles = await listBoardProfiles();
  return profiles.find((profile) => profile.id === boardProfileId) ?? null;
}
