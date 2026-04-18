import { Controller, Get, Post, Patch, Delete, Param, Body, Req, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermission } from '../auth/require-permission.decorator';
import { CategoryService } from './category.service';

@ApiTags('categories')
@Controller()
export class CategoryController {
	constructor(private readonly categories: CategoryService) {}

	@Get('servers/:serverId/categories')
	@ApiOperation({ summary: 'List categories in a server' })
	async list(@Param('serverId') serverId: string) {
		return this.categories.findByServer(serverId);
	}

	@Post('servers/:serverId/categories')
	@RequirePermission('MANAGE_CHANNELS')
	@ApiOperation({ summary: 'Create a category' })
	async create(
		@Param('serverId') serverId: string,
		@Body() body: { name: string },
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		if (!body?.name?.trim()) throw new HttpException('name required', 400);
		try {
			return await this.categories.create(serverId, userId, body.name.trim());
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Patch('categories/:categoryId')
	@RequirePermission('MANAGE_CHANNELS')
	@ApiOperation({ summary: 'Update a category' })
	async update(
		@Param('categoryId') categoryId: string,
		@Body() body: { name?: string },
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			return await this.categories.update(categoryId, userId, body);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Delete('categories/:categoryId')
	@RequirePermission('MANAGE_CHANNELS')
	@ApiOperation({ summary: 'Delete a category (uncategorizes child channels)' })
	async remove(@Param('categoryId') categoryId: string, @Req() req: any) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			await this.categories.delete(categoryId, userId);
			return { success: true };
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Post('servers/:serverId/categories/reorder')
	@RequirePermission('MANAGE_CHANNELS')
	@ApiOperation({ summary: 'Bulk reorder categories by position (drag-and-drop)' })
	async reorder(
		@Param('serverId') serverId: string,
		@Body() body: { categoryIds: string[] },
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		if (!Array.isArray(body.categoryIds) || body.categoryIds.length < 2) {
			throw new HttpException('categoryIds must be an array of at least 2 IDs', 400);
		}
		try {
			return await this.categories.reorder(serverId, body.categoryIds, userId);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Post('categories/:categoryId/swap/:otherCategoryId')
	@RequirePermission('MANAGE_CHANNELS')
	@ApiOperation({ summary: 'Swap two category positions' })
	async swap(
		@Param('categoryId') a: string,
		@Param('otherCategoryId') b: string,
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			await this.categories.swap(a, b, userId);
			return { success: true };
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}
}
