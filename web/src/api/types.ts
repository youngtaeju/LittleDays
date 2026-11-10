import type { components } from './schema'

type Schemas = components['schemas']

export type User = Schemas['User']
export type Asset = Schemas['Asset']
export type AssetSummary = Schemas['AssetSummary']
export type AssetPage = Schemas['Page_AssetSummary']
export type DaySummary = Schemas['DaySummary']
export type DayPage = Schemas['Page_DaySummary']
export type Baby = Schemas['Baby']
export type Settings = Schemas['Settings']
export type Role = Schemas['Role']
export type TrashItem = Schemas['TrashItem']
export type Invite = Schemas['Invite']
export type SessionInfo = Schemas['SessionInfo']
export type MonthCount = Schemas['MonthCount']
