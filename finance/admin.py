from django.contrib import admin  # type: ignore
from django.utils.html import mark_safe  # type: ignore
from .models import Transaction, Budget, Profile, Category, Account, Goal


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
	list_display = ('id', 'title', 'transaction_type', 'amount', 'category', 'date', 'user', 'created_at')
	list_filter = ('transaction_type', 'date', 'category')
	search_fields = ('title', 'category', 'description')
	readonly_fields = ('created_at',)
	ordering = ('-date',)


@admin.register(Budget)
class BudgetAdmin(admin.ModelAdmin):
	list_display = ('id', 'name', 'amount', 'spent', 'remaining_display', 'user', 'created_at')
	list_filter = ('name',)
	search_fields = ('name',)
	readonly_fields = ('created_at',)

	def remaining_display(self, obj):
		return obj.remaining()
	remaining_display.short_description = 'Remaining'


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
	list_display = ('user', 'phone', 'avatar_tag', 'premium')
	search_fields = ('user__username','phone')

	def avatar_tag(self, obj):
		if obj.avatar:
			return mark_safe(f'<img src="{obj.avatar.url}" style="width:40px;height:40px;border-radius:6px;object-fit:cover;"/>')
		return ''
	avatar_tag.short_description = 'Avatar'


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
	list_display = ('id', 'name', 'description', 'created_at')
	search_fields = ('name',)
	readonly_fields = ('created_at',)


@admin.register(Account)
class AccountAdmin(admin.ModelAdmin):
	list_display = ('id', 'name', 'account_type', 'balance', 'user', 'created_at')
	list_filter = ('account_type',)
	search_fields = ('name',)
	readonly_fields = ('created_at',)


@admin.register(Goal)
class GoalAdmin(admin.ModelAdmin):
	list_display = ('id', 'name', 'target_amount', 'current_amount', 'target_date', 'user', 'created_at')
	search_fields = ('name',)
	readonly_fields = ('created_at',)



